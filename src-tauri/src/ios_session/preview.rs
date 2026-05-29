// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

#![cfg(target_os = "macos")]

//! Live SCK preview: captures the iOS Simulator window via ScreenCaptureKit and
//! streams cropped RGBA frames to the frontend over a Tauri binary [`Channel`].
//!
//! ## Threading
//! The SCK session *creation* and *stop* hold Objective-C types that are not
//! `Send` across `.await`, but Tauri command futures must be `Send`. We confine
//! that `!Send` work to [`start_capture_blocking`] / [`stop_session_blocking`],
//! which drive it on a dedicated blocking thread with its own current-thread
//! runtime and hand back `Send` values. The resulting `CaptureSession` is `Send`
//! and its stream runs on an SCK-managed dispatch queue independent of any Tokio
//! runtime, so frames keep flowing after the setup helper returns. The
//! frame-drain task therefore runs on the **main** runtime via [`tokio::spawn`]
//! (it only touches the `Send` receiver, channel, and the pure crop), so it is
//! NOT tied to any temporary runtime.
//!
//! ## Wire format
//! Each message sent on the channel is `InvokeResponseBody::Raw(bytes)` where
//! `bytes` is an 8-byte little-endian header `[width: u32][height: u32]`
//! followed by dense RGBA pixels (`width * height * 4` bytes). The JS side
//! receives this as an `ArrayBuffer`.

use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tracing::{debug, info, warn};

use crate::error::{AppError, AppResult};
use crate::ios_capture::{crop_and_convert, screen_capture_permitted, CaptureSession, Frame};
use crate::ios_session::IosDriverKeeper;

const SIMULATOR_BUNDLE_ID: &str = "com.apple.iphonesimulator";
const SCK_FPS: u32 = 60;

/// Live SCK preview handle. Holds the SCK `CaptureSession` and the abort sender
/// for the frame-draining task.
///
/// Call [`PreviewHandle::teardown`]`.await` for a clean shutdown: it aborts the
/// drain task **and** stops the SCK stream. Dropping the handle without
/// `teardown` fires the abort signal (via `Drop`) and releases the session's
/// Rust references, but cannot await `session.stop()`.
pub struct PreviewHandle {
    // `Option` so `teardown` can move the session out to stop it; `Drop` (which
    // can't move fields) then finds `None`.
    session: Option<CaptureSession>,
    abort: Option<oneshot::Sender<()>>,
}

impl PreviewHandle {
    /// Clean shutdown: aborts the frame-drain task and stops the SCK stream.
    pub async fn teardown(mut self) {
        if let Some(abort) = self.abort.take() {
            let _ = abort.send(());
        }
        if let Some(session) = self.session.take() {
            stop_session_blocking(session).await;
        }
    }
}

impl Drop for PreviewHandle {
    /// Safety net: if the handle is dropped without `teardown`, still abort the
    /// drain task so it doesn't leak the frame `Receiver`. A clean SCK stop needs
    /// the async `teardown`; `Drop` can't `.await`, so the session is only
    /// dropped (releasing its Rust references).
    fn drop(&mut self) {
        if let Some(abort) = self.abort.take() {
            let _ = abort.send(());
        }
    }
}

/// Start a ScreenCaptureKit capture of the iOS Simulator window and stream
/// cropped RGBA frames to the frontend over `channel`. The returned future is
/// `Send` (the `!Send` SCK setup is confined to [`start_capture_blocking`]).
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

    // `!Send` SCK setup on a dedicated thread; returns `Send` values.
    let (session, mut rx) = start_capture_blocking(device_name.clone()).await?;

    // Validate the first frame's geometry before committing (on the main runtime).
    let first = match tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv()).await {
        Ok(Some(f)) => f,
        _ => {
            stop_session_blocking(session).await;
            return Err(AppError::ScreenCaptureFailed(
                "no SCK frame within 2s".to_owned(),
            ));
        }
    };
    let Some((w, h, rgba)) = crop_and_convert(&first, dev_w, dev_h) else {
        stop_session_blocking(session).await;
        return Err(AppError::ScreenCaptureFailed(
            "captured window geometry not recognised (non-default Simulator layout?)".to_owned(),
        ));
    };
    // Clone the channel before moving it into the drain task so we can send the
    // first validated frame here. `Channel` is `Clone` (Arc-backed).
    let channel_for_task = channel.clone();
    let _ = channel.send(InvokeResponseBody::Raw(encode_frame(w, h, &rgba)));

    // Drain task runs on the MAIN runtime (only touches Send values) so it is not
    // tied to the setup helper's temporary runtime.
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
        session: Some(session),
        abort: Some(abort_tx),
    })
}

/// Run the `!Send` SCK capture setup on a dedicated blocking thread with its own
/// current-thread runtime, returning the `Send` session + frame receiver.
async fn start_capture_blocking(
    device_name: String,
) -> AppResult<(CaptureSession, mpsc::Receiver<Frame>)> {
    tokio::task::spawn_blocking(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("current-thread runtime for SCK setup");
        rt.block_on(async move {
            // Match by title (contains the device name); fall back to the first
            // / sole Simulator window if no title matches.
            match CaptureSession::start(SIMULATOR_BUNDLE_ID, Some(device_name.clone()), SCK_FPS)
                .await
            {
                Ok(v) => Ok(v),
                Err(e) => {
                    debug!("SCK title-matched start failed ({e}); retrying any sim window");
                    CaptureSession::start(SIMULATOR_BUNDLE_ID, None, SCK_FPS).await
                }
            }
        })
    })
    .await
    .map_err(|e| AppError::ScreenCaptureFailed(format!("SCK setup thread panicked: {e}")))?
}

/// Stop an SCK session from a `Send` context: `session.stop()` holds `!Send`
/// ObjC types, so drive it on a dedicated blocking thread.
async fn stop_session_blocking(session: CaptureSession) {
    let _ = tokio::task::spawn_blocking(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("current-thread runtime for SCK teardown");
        rt.block_on(session.stop());
    })
    .await;
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
