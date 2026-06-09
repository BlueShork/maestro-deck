// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Physical-iPhone live preview: QuickTime-style USB screen capture.
//!
//! macOS exposes a plugged-in iPhone's SCREEN as a CoreMediaIO DAL capture
//! device (media type "muxed") once the opt-in property
//! `kCMIOHardwarePropertyAllowScreenCaptureDevices` is set — the exact
//! mechanism QuickTime's "Movie Recording → camera: iPhone" uses. An
//! AVFoundation capture session on that device delivers ~27 fps BGRA frames
//! of the pure device screen (no chrome, native pixels), without touching the
//! usbmux tunnel the XCTest driver bridge needs. Feasibility proven by
//! `examples/avf_probe.rs` (27.2 fps @ 1206x2622 on an iPhone 17 Pro).
//!
//! Requires the CAMERA TCC permission (`NSCameraUsageDescription` lives in
//! `src-tauri/Info.plist`); when denied — or when anything else fails — the
//! caller falls back to the `/screenshot` JPEG poller, so this path is purely
//! an upgrade.
//!
//! ## Threading model
//! Mirrors [`crate::sim_capture`]: every `!Send` AVFoundation object lives on
//! a dedicated `std::thread` that owns the session for its whole lifetime.
//! Frames are delivered by AVFoundation on its own dispatch queue to a
//! delegate whose ivars hold only `Send` things (the frame `Sender`), get
//! downscaled there, and are `try_send`-dropped when the consumer is behind.
//! [`AvfCaptureSession`] itself only holds the stop flag + `JoinHandle`, so it
//! is `Send` with no `unsafe impl`.

#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, AllocAnyThread, AnyThread, DefinedClass};
use objc2_av_foundation as avf;
use objc2_av_foundation::AVCaptureVideoDataOutputSampleBufferDelegate;
use objc2_core_media::CMSampleBuffer;
use objc2_core_video as cv;
use objc2_foundation::{
    NSDate, NSDictionary, NSNumber, NSObject, NSObjectProtocol, NSRunLoop, NSString,
};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use crate::error::{AppError, AppResult};
use crate::ios_capture::Frame;

/// Bounded capacity of the frame channel — matches `sim_capture`.
const FRAME_CHANNEL_CAPACITY: usize = 4;

/// How long to wait for the iPhone's muxed DAL device to appear after the
/// CMIO opt-in (publication is asynchronous, typically < 2 s).
const DEVICE_DISCOVERY_BUDGET: Duration = Duration::from_secs(10);

/// How long to wait for the user to answer the one-time camera TCC prompt.
const PERMISSION_BUDGET: Duration = Duration::from_secs(60);

// ---------------------------------------------------------------------------
// CMIO opt-in (the QuickTime mechanism)
// ---------------------------------------------------------------------------

#[repr(C)]
struct CMIOObjectPropertyAddress {
    selector: u32,
    scope: u32,
    element: u32,
}

#[link(name = "CoreMediaIO", kind = "framework")]
extern "C" {
    fn CMIOObjectSetPropertyData(
        object_id: u32,
        address: *const CMIOObjectPropertyAddress,
        qualifier_data_size: u32,
        qualifier_data: *const c_void,
        data_size: u32,
        data: *const c_void,
    ) -> i32;
}

/// Enable DAL screen-capture devices process-wide. Idempotent and cheap.
fn allow_screen_capture_devices() {
    const SYSTEM_OBJECT: u32 = 1; // kCMIOObjectSystemObject
    let addr = CMIOObjectPropertyAddress {
        selector: u32::from_be_bytes(*b"yes "), // kCMIOHardwarePropertyAllowScreenCaptureDevices
        scope: u32::from_be_bytes(*b"glob"),    // kCMIOObjectPropertyScopeGlobal
        element: 0,                             // kCMIOObjectPropertyElementMaster
    };
    let allow: u32 = 1;
    // SAFETY: plain C call with a stack address struct + a u32 payload, exactly
    // as documented for kCMIOHardwarePropertyAllowScreenCaptureDevices.
    let rc = unsafe {
        CMIOObjectSetPropertyData(
            SYSTEM_OBJECT,
            &addr,
            0,
            std::ptr::null(),
            std::mem::size_of::<u32>() as u32,
            (&allow as *const u32).cast(),
        )
    };
    if rc != 0 {
        warn!(
            rc,
            "CMIO AllowScreenCaptureDevices opt-in returned non-zero"
        );
    }
}

// ---------------------------------------------------------------------------
// Frame delegate
// ---------------------------------------------------------------------------

/// Ivars for the capture delegate: the sender half of the frame channel plus
/// the downscale cap. Both `Send` — the delegate runs on AVF's dispatch queue.
struct DelegateIvars {
    tx: mpsc::Sender<Frame>,
    max_dim: u32,
}

define_class!(
    // SAFETY: plain NSObject subclass implementing only NSObjectProtocol +
    // AVCaptureVideoDataOutputSampleBufferDelegate, whose contracts are upheld
    // below. `AnyThread` because AVF invokes the delegate on its own dispatch
    // queue, never the main thread.
    #[unsafe(super(NSObject))]
    #[thread_kind = AnyThread]
    #[name = "MaestroDeckAvfFrameDelegate"]
    #[ivars = DelegateIvars]
    struct FrameDelegate;

    unsafe impl NSObjectProtocol for FrameDelegate {}

    unsafe impl AVCaptureVideoDataOutputSampleBufferDelegate for FrameDelegate {
        // SAFETY: signature matches `captureOutput:didOutputSampleBuffer:fromConnection:`
        // from the delegate protocol exactly (objc2-av-foundation 0.3 trait).
        #[unsafe(method(captureOutput:didOutputSampleBuffer:fromConnection:))]
        fn did_output(
            &self,
            _output: &avf::AVCaptureOutput,
            sample: &CMSampleBuffer,
            _connection: &avf::AVCaptureConnection,
        ) {
            if let Some(frame) = extract_bgra_downscaled(sample, self.ivars().max_dim) {
                // Never block AVF's queue: drop the frame if the consumer is
                // behind (channel full) or gone (receiver dropped).
                let _ = self.ivars().tx.try_send(frame);
            }
        }
    }
);

impl FrameDelegate {
    fn new(tx: mpsc::Sender<Frame>, max_dim: u32) -> Retained<Self> {
        let this = Self::alloc().set_ivars(DelegateIvars { tx, max_dim });
        // SAFETY: standard `[[FrameDelegate alloc] init]` chain.
        unsafe { msg_send![super(this), init] }
    }
}

/// Copy the sample buffer's BGRA pixels, nearest-neighbour downscaled so the
/// longer side is `<= max_dim`, stripping the `bytesPerRow` padding. Returns
/// `None` on any anomaly (no image buffer, lock failure, unexpected format) —
/// skipping a frame is always safe.
fn extract_bgra_downscaled(sb: &CMSampleBuffer, max_dim: u32) -> Option<Frame> {
    // SAFETY: the sample buffer is live for the duration of the delegate call.
    let px = unsafe { sb.image_buffer()? };

    let flags = cv::CVPixelBufferLockFlags::ReadOnly;
    // SAFETY: read-only lock; we copy under the lock and unlock on every path
    // out. The buffer is BGRA (requested via videoSettings); guard anyway.
    unsafe {
        if cv::CVPixelBufferGetPixelFormatType(&px) != u32::from_be_bytes(*b"BGRA") {
            return None;
        }
        if cv::CVPixelBufferLockBaseAddress(&px, flags) != 0 {
            return None;
        }
        let base = cv::CVPixelBufferGetBaseAddress(&px) as *const u8;
        if base.is_null() {
            cv::CVPixelBufferUnlockBaseAddress(&px, flags);
            return None;
        }
        let src_w = cv::CVPixelBufferGetWidth(&px);
        let src_h = cv::CVPixelBufferGetHeight(&px);
        let bpr = cv::CVPixelBufferGetBytesPerRow(&px);
        if src_w == 0 || src_h == 0 {
            cv::CVPixelBufferUnlockBaseAddress(&px, flags);
            return None;
        }

        let longer = src_w.max(src_h) as u32;
        let step = longer.div_ceil(max_dim.max(1)).max(1) as usize;
        let out_w = src_w.div_ceil(step);
        let out_h = src_h.div_ceil(step);

        let mut bgra = vec![0u8; out_w * out_h * 4];
        for oy in 0..out_h {
            let sy = (oy * step).min(src_h - 1);
            let row = base.add(sy * bpr);
            let dst_row = oy * out_w * 4;
            for ox in 0..out_w {
                let sx = (ox * step).min(src_w - 1);
                std::ptr::copy_nonoverlapping(
                    row.add(sx * 4),
                    bgra.as_mut_ptr().add(dst_row + ox * 4),
                    4,
                );
            }
        }
        cv::CVPixelBufferUnlockBaseAddress(&px, flags);

        Some(Frame {
            width: out_w,
            height: out_h,
            bgra,
        })
    }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/// An active USB screen-capture session for a physical iPhone. Only holds
/// `Send` things (stop flag + thread handle); all AVF objects live on the
/// capture thread. Drop (or [`stop`](Self::stop)) tears the capture down.
pub struct AvfCaptureSession {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl AvfCaptureSession {
    /// Attach to the iPhone identified by `udid` (best-effort: the DAL device
    /// whose uniqueID matches, else the only muxed device present) and stream
    /// downscaled BGRA [`Frame`]s. Fails fast with a recoverable error when
    /// the camera permission is denied or no device appears — the caller is
    /// expected to fall back to the screenshot poller.
    pub async fn start(udid: &str, max_dim: u32) -> AppResult<(Self, mpsc::Receiver<Frame>)> {
        let (tx, rx) = mpsc::channel::<Frame>(FRAME_CHANNEL_CAPACITY);
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<AppResult<()>>();
        let thread_stop = stop.clone();
        let udid = udid.to_owned();

        let handle = std::thread::Builder::new()
            .name("avf-capture".into())
            .spawn(move || {
                // Contain ObjC exceptions (converted to Rust panics by objc2's
                // `catch-all`) exactly like sim_capture: worst case the preview
                // never starts / stops, the app survives.
                let setup = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    capture_thread_setup(&udid, max_dim, tx)
                }));
                let session = match setup {
                    Ok(Ok(s)) => {
                        let _ = ready_tx.send(Ok(()));
                        s
                    }
                    Ok(Err(e)) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                    Err(_) => {
                        let _ = ready_tx.send(Err(AppError::ScreenCaptureFailed(
                            "AVFoundation threw while starting the USB screen capture".into(),
                        )));
                        return;
                    }
                };

                // Park until stopped; the delegate streams frames from AVF's
                // own dispatch queue meanwhile.
                while !thread_stop.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(100));
                }
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
                    session.stopRunning();
                }));
                debug!("avf-capture thread exiting; session released");
                drop(session);
            })
            .map_err(|e| AppError::ScreenCaptureFailed(format!("spawn avf-capture thread: {e}")))?;

        match ready_rx.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                let _ = handle.join();
                return Err(e);
            }
            Err(_) => {
                let _ = handle.join();
                return Err(AppError::ScreenCaptureFailed(
                    "avf-capture thread exited before signalling readiness".into(),
                ));
            }
        }

        info!("avf-capture attached (max_dim={max_dim})");
        Ok((
            AvfCaptureSession {
                stop,
                handle: Some(handle),
            },
            rx,
        ))
    }

    /// Signal the capture thread to stop; joining happens in `Drop`.
    pub async fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

impl Drop for AvfCaptureSession {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

/// Runs ON the capture thread: permission, device discovery, session build.
/// Returns the running `AVCaptureSession` (kept alive by the thread). The
/// delegate/input/output are retained by the session itself.
fn capture_thread_setup(
    udid: &str,
    max_dim: u32,
    tx: mpsc::Sender<Frame>,
) -> AppResult<Retained<avf::AVCaptureSession>> {
    allow_screen_capture_devices();

    // Pump this thread's runloop briefly — CMIO publishes DAL devices via
    // runloop-delivered notifications, and a bare std::thread has none running.
    let pump = |secs: f64| {
        let rl = NSRunLoop::currentRunLoop();
        let until = NSDate::dateWithTimeIntervalSinceNow(secs);
        rl.runUntilDate(&until);
    };

    // Camera TCC. NotDetermined → prompt and wait; Denied/Restricted → clean error.
    // SAFETY: AVMediaTypeVideo is a static; status/request are plain class calls.
    unsafe {
        let media_video = avf::AVMediaTypeVideo
            .ok_or_else(|| AppError::ScreenCaptureFailed("AVMediaTypeVideo missing".into()))?;
        let mut status = avf::AVCaptureDevice::authorizationStatusForMediaType(media_video);
        if status == avf::AVAuthorizationStatus::NotDetermined {
            info!("requesting camera permission for the iPhone screen mirror…");
            let done = Arc::new(AtomicBool::new(false));
            let done2 = done.clone();
            let block = block2::RcBlock::new(move |_granted: objc2::runtime::Bool| {
                done2.store(true, Ordering::SeqCst);
            });
            avf::AVCaptureDevice::requestAccessForMediaType_completionHandler(media_video, &block);
            let t0 = Instant::now();
            while !done.load(Ordering::SeqCst) && t0.elapsed() < PERMISSION_BUDGET {
                pump(0.2);
            }
            status = avf::AVCaptureDevice::authorizationStatusForMediaType(media_video);
        }
        if status != avf::AVAuthorizationStatus::Authorized {
            return Err(AppError::ScreenCaptureFailed(
                "camera permission denied — the iPhone screen mirror needs it \
                 (System Settings → Privacy & Security → Camera)"
                    .into(),
            ));
        }
    }

    // Find the iPhone's muxed (screen) device. Prefer a uniqueID/UDID match;
    // accept the only muxed device otherwise (one phone plugged is the norm).
    let udid_norm: String = udid.to_lowercase().replace('-', "");
    let device = {
        let t0 = Instant::now();
        let mut found: Option<Retained<avf::AVCaptureDevice>> = None;
        while found.is_none() && t0.elapsed() < DEVICE_DISCOVERY_BUDGET {
            pump(0.3);
            // SAFETY: devicesWithMediaType returns a live NSArray of devices.
            unsafe {
                let muxed = avf::AVMediaTypeMuxed.ok_or_else(|| {
                    AppError::ScreenCaptureFailed("AVMediaTypeMuxed missing".into())
                })?;
                #[allow(deprecated)]
                let devices = avf::AVCaptureDevice::devicesWithMediaType(muxed);
                let mut single: Option<Retained<avf::AVCaptureDevice>> = None;
                let count = devices.count();
                for d in devices.iter() {
                    let uid = d.uniqueID().to_string().to_lowercase().replace('-', "");
                    if uid.contains(&udid_norm) || udid_norm.contains(&uid) {
                        found = Some(d.clone());
                        break;
                    }
                    if count == 1 {
                        single = Some(d.clone());
                    }
                }
                if found.is_none() {
                    found = single;
                }
            }
        }
        found.ok_or_else(|| {
            AppError::ScreenCaptureFailed(format!(
                "no USB screen-capture device appeared for {udid} \
                 (phone unlocked and trusted?)"
            ))
        })?
    };
    // SAFETY: localizedName on a live device.
    info!(name = %unsafe { device.localizedName() }, "USB screen-capture device found");

    // Build the session: iPhone input → BGRA video-data output → delegate.
    // SAFETY: standard AVCaptureSession assembly; every object outlives its
    // registration (the session retains inputs/outputs, the output retains the
    // delegate+queue).
    unsafe {
        let session = avf::AVCaptureSession::new();
        session.beginConfiguration();

        let input = avf::AVCaptureDeviceInput::deviceInputWithDevice_error(&device)
            .map_err(|e| AppError::ScreenCaptureFailed(format!("iPhone capture input: {e}")))?;
        if !session.canAddInput(&input) {
            return Err(AppError::ScreenCaptureFailed(
                "capture session refused the iPhone input".into(),
            ));
        }
        session.addInput(&input);

        let output = avf::AVCaptureVideoDataOutput::new();
        output.setAlwaysDiscardsLateVideoFrames(true);
        // Request BGRA so the delegate's extraction is a flat 4-byte/px copy.
        // kCVPixelBufferPixelFormatTypeKey is a CFString; CFString and NSString
        // are toll-free bridged, so the reference cast is sound.
        let key: &NSString = std::mem::transmute(cv::kCVPixelBufferPixelFormatTypeKey);
        let value = NSNumber::new_u32(u32::from_be_bytes(*b"BGRA"));
        let settings = NSDictionary::from_slices::<NSString>(
            &[key],
            &[value.as_ref() as &objc2::runtime::AnyObject],
        );
        output.setVideoSettings(Some(&settings));

        let delegate = FrameDelegate::new(tx, max_dim);
        let queue = dispatch2::DispatchQueue::new("maestro-deck-avf-frames", None);
        output.setSampleBufferDelegate_queue(
            Some(ProtocolObject::from_ref(&*delegate)),
            Some(&queue),
        );
        if !session.canAddOutput(&output) {
            return Err(AppError::ScreenCaptureFailed(
                "capture session refused the video output".into(),
            ));
        }
        session.addOutput(&output);
        session.commitConfiguration();
        session.startRunning();

        Ok(session)
    }
}
