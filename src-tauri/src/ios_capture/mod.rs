// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! macOS window capture via ScreenCaptureKit (objc2 bindings).
//!
//! Captures a single on-screen window — in practice the iOS Simulator window —
//! and delivers each frame as a tightly-packed BGRA byte buffer on a bounded
//! async channel. This is the low-level capture core for the smooth-video
//! feature; it is intentionally NOT wired into the Tauri command surface yet
//! (a later increment does that), so the public API is `#[allow(dead_code)]`.
//!
//! The whole module is gated `#[cfg(target_os = "macos")]` (also enforced at the
//! crate level via `lib.rs`) so non-mac builds never pull the objc2 SCK stack.
//!
//! ## Threading model
//! SCK delivers sample buffers on a serial `dispatch` queue we create. The
//! `SCStreamOutput` delegate must never block that queue, so it copies the
//! frame out of the locked `CVPixelBuffer` and `try_send`s it on a bounded
//! `tokio::mpsc` channel, *dropping* the frame if the consumer has fallen
//! behind (the channel is full). This trades latency-induced frame drops for a
//! never-stalling capture pipeline, which is what you want for live preview.
//!
//! ## Lifetime
//! [`CaptureSession`] retains the `SCStream`, the delegate object, and the
//! dispatch queue. The stream keeps running until the session is dropped (or
//! [`CaptureSession::stop`] is called). Dropping the receiver does not stop the
//! stream — the delegate just keeps dropping frames on a full channel.

#![cfg(target_os = "macos")]
// The public capture API is exercised by a later increment that wires it into
// the Tauri command surface; until then the items below are legitimately unused.
#![allow(dead_code)]

use objc2::rc::Retained;
use objc2::runtime::{NSObject, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_core_media::CMSampleBuffer;
use objc2_core_video::{
    CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow, CVPixelBufferGetHeight,
    CVPixelBufferGetWidth, CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags,
    CVPixelBufferUnlockBaseAddress,
};
use objc2_foundation::{NSError, NSObjectProtocol, NSString};
use objc2_screen_capture_kit::{
    SCContentFilter, SCShareableContent, SCStream, SCStreamConfiguration, SCStreamOutput,
    SCStreamOutputType, SCWindow,
};
use tokio::sync::{mpsc, oneshot};
use tracing::{debug, warn};

use crate::error::{AppError, AppResult};

/// `kCVPixelFormatType_32BGRA` — four bytes per pixel, B,G,R,A order.
const PIXEL_FORMAT_BGRA: u32 = 0x4247_5241; // 'BGRA'

/// Bounded capacity of the frame channel. The delegate drops frames when full
/// rather than blocking the SCK dispatch queue.
const FRAME_CHANNEL_CAPACITY: usize = 4;

/// Assumed Retina backing scale used to size the capture surface from the
/// window's point-space frame. SCK requests a fixed pixel surface; the actual
/// delivered buffer reports its own width/height (see [`Frame`]), so an
/// imperfect guess here only affects sharpness, never correctness.
const BACKING_SCALE: f64 = 2.0;

/// A single captured video frame as tightly-packed (no row padding) BGRA bytes.
///
/// `bgra.len() == width * height * 4`. The source `CVPixelBuffer` rows are
/// padded to `bytesPerRow`, which we strip on copy so consumers can treat the
/// buffer as a dense `width * 4`-stride image.
pub struct Frame {
    pub width: usize,
    pub height: usize,
    pub bgra: Vec<u8>,
}

/// Ivars for the [`FrameOutput`] delegate: the sender half of the frame channel.
struct OutputIvars {
    tx: mpsc::Sender<Frame>,
}

define_class!(
    // SAFETY: `FrameOutput` is a plain `NSObject` subclass with no conflicting
    // ivars/methods. It only implements `NSObjectProtocol` + `SCStreamOutput`,
    // whose contracts we uphold below. `AnyThread` is correct because SCK
    // invokes the delegate from its own dispatch queue, not the main thread.
    #[unsafe(super(NSObject))]
    #[thread_kind = AnyThread]
    #[name = "MaestroDeckFrameOutput"]
    #[ivars = OutputIvars]
    struct FrameOutput;

    unsafe impl NSObjectProtocol for FrameOutput {}

    unsafe impl SCStreamOutput for FrameOutput {
        // SAFETY: signature matches `stream:didOutputSampleBuffer:ofType:` from
        // the SCStreamOutput protocol exactly (verified against the pinned
        // objc2-screen-capture-kit 0.3.2 trait definition).
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        fn stream_did_output_sample_buffer(
            &self,
            _stream: &SCStream,
            sample_buffer: &CMSampleBuffer,
            ty: SCStreamOutputType,
        ) {
            if ty != SCStreamOutputType::Screen {
                return;
            }
            if let Some(frame) = extract_bgra(sample_buffer) {
                // Never block the SCK dispatch queue: drop the frame if the
                // consumer is behind (channel full) or gone (receiver dropped).
                let _ = self.ivars().tx.try_send(frame);
            }
        }
    }
);

impl FrameOutput {
    fn new(tx: mpsc::Sender<Frame>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(OutputIvars { tx });
        // SAFETY: standard `[[FrameOutput alloc] init]` chain for a class with
        // initialised ivars; `init` on the NSObject superclass returns `self`.
        unsafe { msg_send![super(this), init] }
    }
}

/// Copy the BGRA pixels out of a sample buffer's image buffer.
///
/// Returns `None` if the sample buffer has no image buffer, isn't a
/// `CVPixelBuffer`, or the base-address lock fails. Rows in the source are
/// padded to `bytesPerRow`; we strip that padding so `bgra` is dense.
fn extract_bgra(sb: &CMSampleBuffer) -> Option<Frame> {
    // `image_buffer()` is unsafe (it dereferences the underlying CMSampleBuffer)
    // and returns `Option<CFRetained<CVImageBuffer>>`. In objc2-core-video 0.3.2
    // `CVPixelBuffer`, `CVImageBuffer` and `CVBuffer` are all type aliases of the
    // same underlying `CVBuffer` struct, so no `downcast` is needed (and indeed
    // `downcast` doesn't apply — `CVBuffer` isn't a distinct `ConcreteType`).
    // Screen sample buffers are always backed by a CVPixelBuffer, so we can pass
    // the image buffer straight to the CVPixelBuffer* accessors.
    let px = unsafe { sb.image_buffer()? };

    let flags = CVPixelBufferLockFlags::ReadOnly;
    // SAFETY: `px` is a live CVPixelBuffer for the duration of this function
    // (held by `image`'s CFRetained). We lock read-only, copy under the lock,
    // and unlock on every path out (including the early `return None`).
    unsafe {
        if CVPixelBufferLockBaseAddress(&px, flags) != 0 {
            return None;
        }

        let base = CVPixelBufferGetBaseAddress(&px) as *const u8;
        if base.is_null() {
            CVPixelBufferUnlockBaseAddress(&px, flags);
            return None;
        }

        let bytes_per_row = CVPixelBufferGetBytesPerRow(&px);
        let width = CVPixelBufferGetWidth(&px);
        let height = CVPixelBufferGetHeight(&px);

        let row_bytes = width * 4;
        let mut buf = vec![0u8; row_bytes * height];
        for row in 0..height {
            std::ptr::copy_nonoverlapping(
                base.add(row * bytes_per_row),
                buf.as_mut_ptr().add(row * row_bytes),
                row_bytes,
            );
        }

        CVPixelBufferUnlockBaseAddress(&px, flags);
        Some(Frame {
            width,
            height,
            bgra: buf,
        })
    }
}

/// An active ScreenCaptureKit capture session.
///
/// Holds the objc2 objects alive (the `SCStream`, the delegate, and the
/// dispatch queue) for as long as you want frames to keep flowing. Drop it (or
/// call [`stop`](Self::stop)) to tear the capture down.
pub struct CaptureSession {
    stream: Retained<SCStream>,
    // Retained so the delegate outlives the stream's reference to it; SCK only
    // holds a weak-ish reference to the output object.
    _output: Retained<FrameOutput>,
    // The serial dispatch queue SCK delivers sample buffers on. Kept alive for
    // the lifetime of the stream.
    _queue: dispatch2::DispatchRetained<dispatch2::DispatchQueue>,
}

// SAFETY: `Retained<SCStream>` / `Retained<FrameOutput>` and the dispatch queue
// are Objective-C reference-counted objects whose methods we only invoke from
// async tasks; SCK itself is thread-safe for start/stop. We move the session
// across `.await` points, so it must be `Send`. The contained objc objects are
// not auto-`Send`, but the operations we perform on them (start/stop capture)
// are documented as callable from any thread.
unsafe impl Send for CaptureSession {}

impl CaptureSession {
    /// Find the first on-screen window owned by `bundle_id` whose title contains
    /// `title_contains` (when `Some`), start capturing it at up to `fps` frames
    /// per second, and return the live session plus a receiver of BGRA frames.
    ///
    /// Keep the returned [`CaptureSession`] alive to keep capturing. Frames are
    /// delivered on a bounded channel (capacity [`FRAME_CHANNEL_CAPACITY`]); the
    /// producer drops frames when the consumer can't keep up.
    pub async fn start(
        bundle_id: &str,
        title_contains: Option<String>,
        fps: u32,
    ) -> AppResult<(Self, mpsc::Receiver<Frame>)> {
        let content = shareable_content().await?;

        // Locate the target window. `windows()` is a snapshot of currently
        // shareable on-screen windows.
        let window =
            find_window(&content, bundle_id, title_contains.as_deref()).ok_or_else(|| {
                AppError::ScreenCaptureFailed(format!(
                    "no on-screen window owned by '{bundle_id}'{} found",
                    title_contains
                        .as_deref()
                        .map(|t| format!(" with title containing '{t}'"))
                        .unwrap_or_default()
                ))
            })?;

        // SAFETY: `frame()` reads the window's CGRect; the window is live (we
        // just pulled it from `content`).
        let frame = unsafe { window.frame() };
        let px_width = ((frame.size.width * BACKING_SCALE).round() as usize).max(2);
        let px_height = ((frame.size.height * BACKING_SCALE).round() as usize).max(2);

        // Desktop-independent window filter: captures exactly this one window.
        // SAFETY: `alloc()` produces a fresh allocation; `window` is a valid
        // SCWindow reference for the duration of the init call.
        let filter = unsafe {
            SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), &window)
        };

        // SAFETY: fresh configuration object; all setters take plain values.
        // `setMinimumFrameInterval` sets the *minimum* interval between frames,
        // i.e. the cap is `fps` fps (1/fps seconds). `CMTime::new(1, fps)`
        // expresses 1/fps seconds.
        let config = unsafe {
            let c = SCStreamConfiguration::new();
            c.setWidth(px_width);
            c.setHeight(px_height);
            c.setMinimumFrameInterval(objc2_core_media::CMTime::new(1, fps.max(1) as i32));
            c.setPixelFormat(PIXEL_FORMAT_BGRA);
            c.setQueueDepth(FRAME_CHANNEL_CAPACITY as isize);
            c.setShowsCursor(false);
            c
        };

        let (tx, rx) = mpsc::channel::<Frame>(FRAME_CHANNEL_CAPACITY);
        let output = FrameOutput::new(tx);

        // We pass `None` for the stream delegate (we don't need stream-level
        // error/stop callbacks for this increment); the SCStreamOutput is added
        // separately below.
        // SAFETY: fresh stream allocation; filter/config are valid live refs.
        let stream = unsafe {
            SCStream::initWithFilter_configuration_delegate(
                SCStream::alloc(),
                &filter,
                &config,
                None,
            )
        };

        // Serial queue SCK delivers sample buffers on.
        let queue = dispatch2::DispatchQueue::new("dev.maestrodeck.ios-capture", None);

        // Register the output for screen sample buffers.
        // SAFETY: `output` adheres to SCStreamOutput; `queue` is a live serial
        // dispatch queue. Returns `Err(NSError)` on failure.
        let output_proto = ProtocolObject::from_ref(&*output);
        unsafe {
            stream
                .addStreamOutput_type_sampleHandlerQueue_error(
                    output_proto,
                    SCStreamOutputType::Screen,
                    Some(&queue),
                )
                .map_err(|e| {
                    AppError::ScreenCaptureFailed(format!("addStreamOutput failed: {}", ns_err(&e)))
                })?;
        }

        // Start the capture and await the completion handler.
        start_capture(&stream).await?;

        debug!(
            "ScreenCaptureKit capture started for '{bundle_id}' ({px_width}x{px_height} @ {fps}fps)"
        );

        Ok((
            CaptureSession {
                stream,
                _output: output,
                _queue: queue,
            },
            rx,
        ))
    }

    /// Stop the underlying stream and await the SCK completion handler. The
    /// retained objc objects are released when the session is dropped.
    pub async fn stop(&self) {
        let (tx, rx) = oneshot::channel::<Option<String>>();
        // The completion block fires on a background queue and is called once.
        let tx = std::cell::RefCell::new(Some(tx));
        let handler = block2::RcBlock::new(move |err: *mut NSError| {
            if let Some(tx) = tx.borrow_mut().take() {
                // SAFETY: `err` is either null or a valid NSError owned by SCK
                // for the duration of this callback.
                let msg = unsafe { err.as_ref() }.map(ns_err);
                let _ = tx.send(msg);
            }
        });

        // SAFETY: `stream` is a live SCStream; the handler block is valid for
        // the duration of the call (SCK retains it until it fires).
        unsafe {
            self.stream.stopCaptureWithCompletionHandler(Some(&handler));
        }

        match rx.await {
            Ok(Some(msg)) => warn!("stopCapture reported error: {msg}"),
            Ok(None) => debug!("ScreenCaptureKit capture stopped"),
            Err(_) => warn!("stopCapture completion handler dropped without firing"),
        }
    }
}

/// Fetch the current shareable content (windows/displays) asynchronously.
///
/// SCK fires the completion handler on a background queue; we bridge it to a
/// `oneshot` so callers can `.await`.
async fn shareable_content() -> AppResult<Retained<SCShareableContent>> {
    let (tx, rx) = oneshot::channel::<Result<Retained<SCShareableContent>, String>>();
    let tx = std::cell::RefCell::new(Some(tx));

    let handler =
        block2::RcBlock::new(move |content: *mut SCShareableContent, err: *mut NSError| {
            let Some(tx) = tx.borrow_mut().take() else {
                return;
            };
            // SAFETY: per the SCK contract exactly one of `content`/`err` is
            // non-null. The block does NOT transfer ownership of `content`, so
            // we must `retain` it to keep it alive past the callback.
            let result = unsafe {
                if let Some(content) = Retained::retain(content) {
                    Ok(content)
                } else if let Some(err) = err.as_ref() {
                    Err(ns_err(err))
                } else {
                    Err("getShareableContent returned neither content nor error".to_owned())
                }
            };
            let _ = tx.send(result);
        });

    // SAFETY: the handler block is valid for the duration of the async call;
    // SCK retains it until it fires exactly once.
    unsafe {
        SCShareableContent::getShareableContentWithCompletionHandler(&handler);
    }

    match rx.await {
        Ok(Ok(content)) => Ok(content),
        Ok(Err(msg)) => Err(AppError::ScreenCaptureFailed(format!(
            "getShareableContent failed: {msg}"
        ))),
        Err(_) => Err(AppError::ScreenCaptureFailed(
            "getShareableContent completion handler dropped without firing".to_owned(),
        )),
    }
}

/// Start the stream, awaiting the SCK completion handler.
async fn start_capture(stream: &SCStream) -> AppResult<()> {
    let (tx, rx) = oneshot::channel::<Option<String>>();
    let tx = std::cell::RefCell::new(Some(tx));
    let handler = block2::RcBlock::new(move |err: *mut NSError| {
        if let Some(tx) = tx.borrow_mut().take() {
            // SAFETY: `err` is null or a valid NSError for this callback.
            let msg = unsafe { err.as_ref() }.map(ns_err);
            let _ = tx.send(msg);
        }
    });

    // SAFETY: `stream` is live; the block is retained by SCK until it fires.
    unsafe {
        stream.startCaptureWithCompletionHandler(Some(&handler));
    }

    match rx.await {
        Ok(None) => Ok(()),
        Ok(Some(msg)) => Err(AppError::ScreenCaptureFailed(format!(
            "startCapture failed: {msg}"
        ))),
        Err(_) => Err(AppError::ScreenCaptureFailed(
            "startCapture completion handler dropped without firing".to_owned(),
        )),
    }
}

/// Find the first window owned by `bundle_id` (optionally whose title contains
/// `title_contains`).
fn find_window(
    content: &SCShareableContent,
    bundle_id: &str,
    title_contains: Option<&str>,
) -> Option<Retained<SCWindow>> {
    // SAFETY: `windows()` returns a snapshot NSArray of live SCWindow objects.
    let windows = unsafe { content.windows() };
    for window in windows.iter() {
        // SAFETY: `window` is a live SCWindow from the array.
        let app = unsafe { window.owningApplication() };
        let Some(app) = app else { continue };
        // SAFETY: `bundleIdentifier()` returns a live NSString.
        let bid = unsafe { app.bundleIdentifier() };
        if bid.to_string() != bundle_id {
            continue;
        }

        if let Some(needle) = title_contains {
            // SAFETY: `title()` returns an optional live NSString.
            let title = unsafe { window.title() };
            let matches = title
                .map(|t| t.to_string().contains(needle))
                .unwrap_or(false);
            if !matches {
                continue;
            }
        }

        return Some(window);
    }
    None
}

/// Render an `NSError` to a human-readable string (`localizedDescription`).
fn ns_err(err: &NSError) -> String {
    // SAFETY: `localizedDescription` returns a live NSString for the error.
    let desc: Retained<NSString> = unsafe { msg_send![err, localizedDescription] };
    desc.to_string()
}

/// True if the Screen Recording permission is already granted.
///
/// Wraps `CGPreflightScreenCaptureAccess`. Does NOT prompt.
pub fn screen_capture_permitted() -> bool {
    objc2_core_graphics::CGPreflightScreenCaptureAccess()
}

/// Trigger the system Screen Recording permission prompt and return the current
/// grant state.
///
/// Wraps `CGRequestScreenCaptureAccess`. The first call shows the prompt; the
/// grant only takes effect on the next app launch, so a freshly-prompted user
/// will still see `false` here until they restart.
pub fn request_screen_capture() -> bool {
    objc2_core_graphics::CGRequestScreenCaptureAccess()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_check_does_not_panic() {
        // Just exercise the FFI path; the actual grant state depends on the
        // host's TCC database, so we only assert it returns a bool.
        let _granted: bool = screen_capture_permitted();
    }
}
