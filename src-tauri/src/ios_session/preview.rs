// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

#![cfg(target_os = "macos")]

//! Live SCK preview: captures the iOS Simulator window via ScreenCaptureKit and
//! streams cropped RGBA frames to the frontend over a Tauri binary [`Channel`].
//!
//! ## Wire format
//! Each message sent on the channel is `InvokeResponseBody::Raw(bytes)` where
//! `bytes` is an 8-byte little-endian header `[width: u32][height: u32]`
//! followed by dense RGBA pixels (`width * height * 4` bytes). The JS side
//! receives this as an `ArrayBuffer`.

use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::oneshot;
use tracing::{debug, info, warn};

use crate::error::{AppError, AppResult};
use crate::ios_capture::{crop_and_convert, screen_capture_permitted, CaptureSession};
use crate::ios_session::IosDriverKeeper;

const SIMULATOR_BUNDLE_ID: &str = "com.apple.iphonesimulator";
const SCK_FPS: u32 = 60;

/// Live SCK preview handle. Holds the SCK `CaptureSession` and the abort
/// sender for the frame-draining task.
///
/// Call [`PreviewHandle::teardown`]`.await` for a clean shutdown: it aborts the
/// drain task **and** stops the SCK stream via `session.stop().await`. Dropping
/// the handle without calling `teardown` fires the abort signal (via `Drop`) and
/// releases the session's Rust references, but cannot await `session.stop()` —
/// the SCK stream may linger until the OS reclaims it.
pub struct PreviewHandle {
    session: CaptureSession,
    abort: Option<oneshot::Sender<()>>,
}

impl PreviewHandle {
    /// Clean shutdown: aborts the frame-drain task and stops the SCK stream.
    ///
    /// This is the preferred way to tear down a preview. If the handle is
    /// simply dropped, `Drop` sends the abort signal but cannot await
    /// `session.stop()`.
    pub async fn teardown(mut self) {
        // Take the sender so that Drop later finds None and is a no-op.
        if let Some(abort) = self.abort.take() {
            let _ = abort.send(());
        }
        self.session.stop().await;
    }
}

impl Drop for PreviewHandle {
    /// Safety net: if the handle is dropped without calling `teardown`, still
    /// abort the drain task so it doesn't leak (it holds the frame `Receiver`
    /// forever). A full, clean SCK stop requires the async `teardown`; Drop
    /// can't `.await` `session.stop()`, so dropping only releases the stream's
    /// Rust references.
    fn drop(&mut self) {
        if let Some(abort) = self.abort.take() {
            let _ = abort.send(());
        }
    }
}

/// Start a ScreenCaptureKit capture of the iOS Simulator window and stream
/// cropped RGBA frames to the frontend over `channel`.
///
/// Returns a [`PreviewHandle`]. Call [`PreviewHandle::teardown`]`.await` for a
/// clean stop (aborts the drain task and stops the SCK stream). Dropping the
/// handle without `teardown` fires the abort signal but cannot await
/// `session.stop()`, so the SCK stream may linger.
pub async fn spawn_ios_preview(
    keeper: Arc<IosDriverKeeper>,
    device_name: String,
    channel: Channel<InvokeResponseBody>,
) -> AppResult<PreviewHandle> {
    if !screen_capture_permitted() {
        return Err(AppError::ScreenCaptureFailed(
            "Screen Recording permission not granted".to_owned(),
        ));
    }
    let info = keeper.device_info().ok_or_else(|| {
        AppError::ScreenCaptureFailed("device pixel dims not known yet".to_owned())
    })?;
    let (dev_w, dev_h) = (info.width_pixels, info.height_pixels);
    if dev_w == 0 || dev_h == 0 {
        return Err(AppError::ScreenCaptureFailed(
            "device reported zero pixel dimensions".to_owned(),
        ));
    }

    // Match the Simulator window by title (contains the device name). If no
    // title matches, retry with no title filter (first / sole Simulator window).
    let (session, mut rx) = match CaptureSession::start(
        SIMULATOR_BUNDLE_ID,
        Some(device_name.clone()),
        SCK_FPS,
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            debug!("SCK title-matched start failed ({e}); retrying any sim window");
            CaptureSession::start(SIMULATOR_BUNDLE_ID, None, SCK_FPS).await?
        }
    };

    // Validate the first frame's geometry before committing.
    let first = match tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv()).await {
        Ok(Some(f)) => f,
        _ => {
            session.stop().await;
            return Err(AppError::ScreenCaptureFailed(
                "no SCK frame within 2s".to_owned(),
            ));
        }
    };
    let Some((w, h, rgba)) = crop_and_convert(&first, dev_w, dev_h) else {
        session.stop().await;
        return Err(AppError::ScreenCaptureFailed(
            "captured window geometry not recognised (non-default Simulator layout?)".to_owned(),
        ));
    };
    // Clone the channel before moving it into the spawned task so we can send
    // the first validated frame here. `Channel` is `Clone` (Arc-backed).
    let channel_for_task = channel.clone();
    let _ = channel.send(InvokeResponseBody::Raw(encode_frame(w, h, &rgba)));

    let (abort_tx, mut abort_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                biased;
                _ = &mut abort_rx => {
                    info!("iOS SCK preview task aborted");
                    return;
                }
                frame = rx.recv() => {
                    let Some(frame) = frame else {
                        warn!("SCK frame channel closed");
                        return;
                    };
                    if let Some((w, h, rgba)) = crop_and_convert(&frame, dev_w, dev_h) {
                        if channel_for_task
                            .send(InvokeResponseBody::Raw(encode_frame(w, h, &rgba)))
                            .is_err()
                        {
                            info!("SCK frame channel send failed (frontend gone)");
                            return;
                        }
                    }
                }
            }
        }
    });

    info!(device = %device_name, "iOS SCK preview started ({dev_w}x{dev_h} px device)");
    Ok(PreviewHandle {
        session,
        abort: Some(abort_tx),
    })
}

/// Frame wire format: 8-byte little-endian header `[width u32][height u32]`
/// followed by dense RGBA pixels.
fn encode_frame(w: u32, h: u32, rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + rgba.len());
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend_from_slice(rgba);
    out
}
