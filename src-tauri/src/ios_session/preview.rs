// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

#![cfg(target_os = "macos")]

//! Live iOS-Simulator preview: captures the booted simulator's display
//! framebuffer **headlessly** via the CoreSimulator / SimulatorKit private APIs
//! ([`crate::sim_capture::SimCaptureSession`]) and streams RGBA frames to the
//! frontend over a Tauri binary [`Channel`].
//!
//! NOTE: the capture source is now the CoreSimulator display framebuffer
//! (`IOSurface`), NOT ScreenCaptureKit. The dormant SCK source lives in
//! `crate::ios_capture` and is no longer used by this path.
//!
//! ## Threading
//! [`SimCaptureSession::start`] / [`SimCaptureSession::stop`] are `Send` async
//! (all the `!Send` objc objects live on the session's own poll thread), so
//! `spawn_ios_preview`'s future is `Send` and the Tauri command can await it
//! directly — no `spawn_blocking` bridge needed. The frame-drain task runs on
//! the **main** runtime via [`tokio::spawn`] (it only touches the `Send`
//! receiver, channel, and the pure conversion).
//!
//! ## Wire format
//! Each message sent on the channel is `InvokeResponseBody::Raw(bytes)` where
//! `bytes` is an 8-byte little-endian header `[width: u32][height: u32]`
//! followed by dense RGBA pixels (`width * height * 4` bytes). The JS side
//! receives this as an `ArrayBuffer`.

use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::oneshot;
use tracing::{info, warn};

use crate::error::AppResult;
use crate::ios_capture::crop_and_convert;
use crate::ios_session::IosDriverKeeper;

/// Capture frame rate (Hz) requested from the simulator framebuffer poller.
/// 30 (not 60): each frame crosses the Tauri IPC channel as raw RGBA, and at
/// 60 Hz the webview main thread spends so long receiving frames that typing
/// in the editor lags. 30 Hz halves that cost and stays visually smooth.
const SIM_FPS: u32 = 30;
/// Longer-side cap (px) for downscaled frames. 700 keeps a frame under ~1 MB
/// of raw RGBA (vs ~1.5 MB at 900) — the preview canvas renders well below
/// native resolution anyway, so the visual difference is negligible.
const SIM_MAX_DIM: u32 = 700;

/// Live preview handle. Holds the headless [`SimCaptureSession`] and the abort
/// sender for the frame-draining task.
///
/// [`crate::sim_capture::SimCaptureSession`]
///
/// Call [`PreviewHandle::teardown`]`.await` for a clean shutdown: it aborts the
/// drain task **and** stops the capture session. Dropping the handle without
/// `teardown` fires the abort signal (via `Drop`); `SimCaptureSession`'s own
/// `Drop` then joins its poll thread and releases the surface/device refs.
pub struct PreviewHandle {
    // `Option` so `teardown` can move the session out to stop it; `Drop` (which
    // can't move fields) then finds `None`.
    session: Option<crate::sim_capture::SimCaptureSession>,
    abort: Option<oneshot::Sender<()>>,
}

impl PreviewHandle {
    /// Clean shutdown: aborts the frame-drain task and stops the capture session.
    pub async fn teardown(mut self) {
        if let Some(abort) = self.abort.take() {
            let _ = abort.send(());
        }
        if let Some(session) = self.session.take() {
            session.stop().await;
            // Dropping `session` here joins its poll thread and releases the
            // surface/device refs (clean teardown).
        }
    }
}

impl Drop for PreviewHandle {
    /// Safety net: if the handle is dropped without `teardown`, still abort the
    /// drain task so it doesn't leak the frame `Receiver`. The held
    /// `SimCaptureSession`'s own `Drop` joins its poll thread and releases the
    /// surface/device refs.
    fn drop(&mut self) {
        if let Some(abort) = self.abort.take() {
            let _ = abort.send(());
        }
    }
}

/// Start a headless capture of the booted iOS Simulator's display framebuffer
/// and stream RGBA frames to the frontend over `channel`. The returned future
/// is `Send` (`SimCaptureSession::start` is `Send` async), so the Tauri command
/// can await it directly.
///
/// `device_name` is only used for logging (the headless source is keyed on the
/// keeper's UDID, not a window title).
pub async fn spawn_ios_preview(
    keeper: Arc<IosDriverKeeper>,
    device_name: String,
    channel: Channel<InvokeResponseBody>,
) -> AppResult<PreviewHandle> {
    // Headless attach to the booted simulator's display IOSurface. The returned
    // session + receiver are `Send`, so no `spawn_blocking` bridge is needed.
    let (session, mut rx) =
        crate::sim_capture::SimCaptureSession::start(keeper.udid(), SIM_FPS, SIM_MAX_DIM).await?;

    // Drain task runs on the MAIN runtime (only touches Send values).
    let (abort_tx, mut abort_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                biased;
                _ = &mut abort_rx => {
                    info!("iOS preview task aborted");
                    return;
                }
                frame = rx.recv() => {
                    let Some(frame) = frame else {
                        warn!("preview frame channel closed");
                        return;
                    };
                    // Identity crop + BGRA→RGBA: the IOSurface is already the pure
                    // device screen, so we pass the frame's own dims (never None
                    // for nonzero dims; skip on the impossible None).
                    if let Some((w, h, rgba)) =
                        crop_and_convert(&frame, frame.width as u32, frame.height as u32)
                    {
                        if channel
                            .send(InvokeResponseBody::Raw(encode_frame(w, h, &rgba)))
                            .is_err()
                        {
                            info!("preview frame channel send failed (frontend gone)");
                            return;
                        }
                    }
                }
            }
        }
    });

    info!(device = %device_name, "iOS preview started (headless CoreSimulator framebuffer)");
    Ok(PreviewHandle {
        session: Some(session),
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
