// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Feasibility probe: QuickTime-style USB screen capture of a PHYSICAL iPhone.
//!
//! macOS exposes a plugged-in iPhone's screen as a CoreMediaIO DAL capture
//! device (media type "muxed") once the opt-in property
//! `kCMIOHardwarePropertyAllowScreenCaptureDevices` is set — the exact
//! mechanism QuickTime's "Movie Recording → camera: iPhone" uses. If this
//! works we get a 30-60 fps live preview instead of the ~10 fps
//! `/screenshot` poll, without touching the usbmux driver tunnel.
//!
//! Run with the iPhone plugged in (and unlocked):
//!   cargo run --manifest-path src-tauri/Cargo.toml --example avf_probe
//!
//! Expect a CAMERA permission prompt for your terminal on first run
//! (System Settings → Privacy & Security → Camera).

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("avf_probe is macOS-only.");
}

#[cfg(target_os = "macos")]
fn main() {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
    use std::time::{Duration, Instant};

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::{define_class, msg_send, AllocAnyThread};
    use objc2_av_foundation as avf;
    use objc2_av_foundation::AVCaptureVideoDataOutputSampleBufferDelegate;
    use objc2_core_media::CMSampleBuffer;
    use objc2_foundation::{NSDate, NSObject, NSObjectProtocol, NSRunLoop, NSString};

    // ---- 1. Allow DAL screen-capture devices (the QuickTime opt-in) --------
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
    const SYSTEM_OBJECT: u32 = 1; // kCMIOObjectSystemObject
    let addr = CMIOObjectPropertyAddress {
        selector: u32::from_be_bytes(*b"yes "), // kCMIOHardwarePropertyAllowScreenCaptureDevices
        scope: u32::from_be_bytes(*b"glob"),    // kCMIOObjectPropertyScopeGlobal
        element: 0,                             // kCMIOObjectPropertyElementMaster
    };
    let allow: u32 = 1;
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
    println!("CMIO AllowScreenCaptureDevices set (rc={rc}, 0 = ok)");

    // Helper: pump the main runloop so CMIO/AVF device-arrival events deliver.
    let pump = |secs: f64| {
        let rl = NSRunLoop::currentRunLoop();
        let until = NSDate::dateWithTimeIntervalSinceNow(secs);
        rl.runUntilDate(&until);
    };

    // ---- 2. Camera permission (TCC) ----------------------------------------
    unsafe {
        let media_video = avf::AVMediaTypeVideo.expect("AVMediaTypeVideo");
        let status = avf::AVCaptureDevice::authorizationStatusForMediaType(media_video);
        println!("camera TCC status: {status:?} (3 = authorized)");
        if status != avf::AVAuthorizationStatus::Authorized {
            println!("requesting camera access — click ALLOW in the prompt…");
            let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let done2 = done.clone();
            let block = RcBlock::new(move |granted: objc2::runtime::Bool| {
                println!("camera access granted: {}", granted.as_bool());
                done2.store(true, Ordering::SeqCst);
            });
            avf::AVCaptureDevice::requestAccessForMediaType_completionHandler(media_video, &block);
            let t0 = Instant::now();
            while !done.load(Ordering::SeqCst) && t0.elapsed() < Duration::from_secs(60) {
                pump(0.2);
            }
        }
    }

    // ---- 3. Find the iPhone (muxed DAL device) -----------------------------
    println!(
        "looking for the iPhone screen-capture device (up to 15 s — keep it plugged & unlocked)…"
    );
    let device: Option<Retained<avf::AVCaptureDevice>> = {
        let t0 = Instant::now();
        let mut found = None;
        while found.is_none() && t0.elapsed() < Duration::from_secs(15) {
            pump(0.5);
            unsafe {
                let muxed = avf::AVMediaTypeMuxed.expect("AVMediaTypeMuxed");
                #[allow(deprecated)]
                let devices = avf::AVCaptureDevice::devicesWithMediaType(muxed);
                for d in devices.iter() {
                    let name = d.localizedName();
                    println!("  candidate muxed device: {name}");
                    found = Some(d.clone());
                }
            }
        }
        found
    };
    let Some(device) = device else {
        eprintln!(
            "✗ no muxed capture device appeared.\n  → iPhone plugged in, unlocked, 'Trust this computer' accepted?\n  → camera permission granted to the terminal?"
        );
        return;
    };
    println!("✓ device: {}", unsafe { device.localizedName() });

    // ---- 4. Capture session + frame counting delegate ----------------------
    static FRAMES: AtomicU32 = AtomicU32::new(0);
    static LAST_W: AtomicUsize = AtomicUsize::new(0);
    static LAST_H: AtomicUsize = AtomicUsize::new(0);

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "AvfProbeDelegate"]
        struct ProbeDelegate;

        unsafe impl NSObjectProtocol for ProbeDelegate {}

        unsafe impl AVCaptureVideoDataOutputSampleBufferDelegate for ProbeDelegate {
            #[unsafe(method(captureOutput:didOutputSampleBuffer:fromConnection:))]
            fn did_output(
                &self,
                _output: &avf::AVCaptureOutput,
                sample: &CMSampleBuffer,
                _connection: &avf::AVCaptureConnection,
            ) {
                FRAMES.fetch_add(1, Ordering::Relaxed);
                if let Some(img) = unsafe { sample.image_buffer() } {
                    let w = objc2_core_video::CVPixelBufferGetWidth(&img);
                    let h = objc2_core_video::CVPixelBufferGetHeight(&img);
                    LAST_W.store(w, Ordering::Relaxed);
                    LAST_H.store(h, Ordering::Relaxed);
                }
            }
        }
    );

    impl ProbeDelegate {
        fn new() -> Retained<Self> {
            let this = Self::alloc();
            unsafe { msg_send![this, init] }
        }
    }

    unsafe {
        let session = avf::AVCaptureSession::new();
        session.beginConfiguration();

        let input = match avf::AVCaptureDeviceInput::deviceInputWithDevice_error(&device) {
            Ok(i) => i,
            Err(e) => {
                eprintln!("✗ deviceInput failed: {e}");
                return;
            }
        };
        if session.canAddInput(&input) {
            session.addInput(&input);
        } else {
            eprintln!("✗ session refused the iPhone input");
            return;
        }

        let output = avf::AVCaptureVideoDataOutput::new();
        output.setAlwaysDiscardsLateVideoFrames(true);
        let delegate = ProbeDelegate::new();
        let queue = dispatch2::DispatchQueue::new("avf-probe-frames", None);
        output.setSampleBufferDelegate_queue(
            Some(ProtocolObject::from_ref(&*delegate)),
            Some(&queue),
        );
        if session.canAddOutput(&output) {
            session.addOutput(&output);
        } else {
            eprintln!("✗ session refused the video data output");
            return;
        }
        session.commitConfiguration();

        println!("starting capture — counting frames for 5 s…");
        session.startRunning();

        let t0 = Instant::now();
        while t0.elapsed() < Duration::from_secs(5) {
            pump(0.25);
        }
        session.stopRunning();

        let frames = FRAMES.load(Ordering::Relaxed);
        let secs = t0.elapsed().as_secs_f64();
        println!("\n=== RESULT ===");
        println!(
            "frames: {frames} in {secs:.1}s  →  {:.1} fps",
            frames as f64 / secs
        );
        println!(
            "frame size: {}x{} px",
            LAST_W.load(Ordering::Relaxed),
            LAST_H.load(Ordering::Relaxed)
        );
        if frames > 0 {
            println!(
                "\n✓ USB screen capture works — this is the high-fps physical preview source."
            );
        } else {
            let _ = &NSString::new(); // keep NSString import used on all paths
            eprintln!("\n⚠️  0 frames — device found but no video. Screen locked? Try unlocking / tapping the phone.");
        }
    }
}
