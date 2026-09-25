// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Headless iOS-Simulator framebuffer probe.
//!
//! Proves we can capture a booted simulator's live display IOSurface with NO
//! `Simulator.app` window open, using the same CoreSimulator / SimulatorKit
//! private-API path that idb / FBSimulatorControl use.
//!
//! Flow: dlopen CoreSimulator + SimulatorKit → SimServiceContext →
//! defaultDeviceSet → find SimDevice by UDID → device.io → ioPorts →
//! port.descriptor → framebufferSurface (IOSurface) → register a
//! damageRectangles callback → pump ~6s → report dims / format / frames / fps /
//! bytes-per-frame.
//!
//! Run on macOS with a simulator BOOTED (window need NOT be open):
//!   cargo run --manifest-path src-tauri/Cargo.toml --example simfb_probe

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("simfb_probe is macOS-only.");
}

#[cfg(target_os = "macos")]
fn main() {
    real_main::run();
}

#[cfg(target_os = "macos")]
mod real_main {
    use block2::{ManualBlockEncoding, RcBlock};
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, AnyProtocol};
    use objc2_foundation::{NSArray, NSString};
    use std::ffi::c_void;
    use std::ptr::null_mut;
    use std::sync::atomic::{AtomicU32, Ordering::Relaxed};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    /// Encoding for `void (^)(id)` — used for all three screen-callback blocks.
    /// SimulatorKit's ROCK proxy refuses blocks lacking a signature field
    /// ("Block is missing signature field"), so we attach one explicitly.
    /// `v16@?0@8`: void return, 16-byte frame; arg0 = the block itself (@?) at
    /// offset 0, arg1 = an object (@) at offset 8.
    struct VoidIdBlock;
    // SAFETY: matches a `void (^)(id)` block on 64-bit.
    unsafe impl ManualBlockEncoding for VoidIdBlock {
        type Arguments = (*mut AnyObject,);
        type Return = ();
        const ENCODING_CSTR: &'static std::ffi::CStr = c"v16@?0@8";
    }

    const TARGET_UDID: &str = "172BA2A3-894E-4632-B8DB-C96D87BCFF62";
    const DEVELOPER_DIR: &str = "/Applications/Xcode.app/Contents/Developer";
    const CAPTURE_SECS: u64 = 6;

    extern "C" {
        fn dlopen(p: *const libc::c_char, f: libc::c_int) -> *mut c_void;
        fn dispatch_get_global_queue(identifier: isize, flags: usize) -> *mut AnyObject;
    }
    const RTLD_NOW: libc::c_int = 0x2;

    fn dlopen_or_die(path: &str) {
        let c = std::ffi::CString::new(path).unwrap();
        let h = unsafe { dlopen(c.as_ptr(), RTLD_NOW) };
        assert!(!h.is_null(), "dlopen failed for {path}");
    }

    /// Render an `id*` error (NSError or any object) to a String for logging.
    fn err_str(err: *mut AnyObject) -> String {
        if err.is_null() {
            return "(nil)".into();
        }
        let ep = std::panic::AssertUnwindSafe(err);
        let r: Result<String, _> = objc2::exception::catch(move || unsafe {
            let s: Retained<NSString> = msg_send![&*{ *ep }, localizedDescription];
            s.to_string()
        });
        r.unwrap_or_else(|_| "(no localizedDescription)".into())
    }

    /// Render an NSException (name + reason) for logging.
    fn exc_str(exc: *mut AnyObject) -> String {
        if exc.is_null() {
            return "(nil)".into();
        }
        let ep = std::panic::AssertUnwindSafe(exc);
        objc2::exception::catch(move || unsafe {
            let e = *ep;
            let name: Retained<NSString> = msg_send![&*e, name];
            let reason: Retained<NSString> = msg_send![&*e, reason];
            format!("{name}: {reason}")
        })
        .unwrap_or_else(|_| {
            // Not an NSException — try a plain description.
            err_str(exc)
        })
    }

    pub fn run() {
        // 1. Load the private frameworks BEFORE touching any class.
        dlopen_or_die("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator");
        dlopen_or_die(&format!(
            "{DEVELOPER_DIR}/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"
        ));
        println!("frameworks loaded ✓");

        // 2. SimServiceContext for our developer dir.
        let ctx_cls = AnyClass::get(c"SimServiceContext").expect("SimServiceContext class missing");
        let dev_dir = NSString::from_str(DEVELOPER_DIR);
        let mut err: *mut AnyObject = null_mut();
        let ctx: Retained<AnyObject> = unsafe {
            msg_send![ctx_cls, sharedServiceContextForDeveloperDir: &*dev_dir, error: &mut err]
        };
        if !err.is_null() {
            panic!(
                "sharedServiceContextForDeveloperDir failed: {}",
                err_str(err)
            );
        }
        println!("SimServiceContext ✓");

        // 3. Default device set.
        let mut err2: *mut AnyObject = null_mut();
        let set: Retained<AnyObject> =
            unsafe { msg_send![&*ctx, defaultDeviceSetWithError: &mut err2] };
        if !err2.is_null() {
            panic!("defaultDeviceSetWithError failed: {}", err_str(err2));
        }
        println!("defaultDeviceSet ✓");

        // 4. Find the SimDevice by UDID.
        let devices: Retained<NSArray<AnyObject>> = unsafe { msg_send![&*set, availableDevices] };
        let count = devices.count();
        let mut dev: Option<Retained<AnyObject>> = None;
        for i in 0..count {
            let d = devices.objectAtIndex(i);
            let udid: Retained<AnyObject> = unsafe { msg_send![&*d, UDID] };
            let s: Retained<NSString> = unsafe { msg_send![&*udid, UUIDString] };
            if s.to_string().eq_ignore_ascii_case(TARGET_UDID) {
                dev = Some(d);
                break;
            }
        }
        let dev = dev.unwrap_or_else(|| {
            panic!("device {TARGET_UDID} not found among {count} available devices")
        });
        let name: Retained<NSString> = unsafe { msg_send![&*dev, name] };
        let state: u64 = unsafe { msg_send![&*dev, state] };
        // SimDeviceState: 0=Creating 1=Shutdown 2=Booting 3=Booted 4=ShuttingDown
        println!("SimDevice ✓  ({} / {TARGET_UDID})  state={state}", name);
        if state != 3 {
            eprintln!("⚠️  device not Booted (state={state}) in the probe's service context!");
        }

        // 5/6. device.io → ioPorts.
        let io: Retained<AnyObject> = unsafe { msg_send![&*dev, io] };
        let ports: Retained<NSArray<AnyObject>> = unsafe { msg_send![&*io, ioPorts] };
        let nports = ports.count();
        println!("ioPorts: {nports}");

        // 7/8. Pick the descriptor that yields a non-nil surface.
        let renderable_proto = AnyProtocol::get(c"SimDisplayIOSurfaceRenderable");
        let mut chosen: Option<(Retained<AnyObject>, Retained<objc2_io_surface::IOSurface>)> = None;

        for i in 0..nports {
            let port = ports.objectAtIndex(i);
            let port_ptr = std::panic::AssertUnwindSafe(Retained::as_ptr(&port));
            let descriptor: Result<*mut AnyObject, _> =
                objc2::exception::catch(move || unsafe { msg_send![&*{ *port_ptr }, descriptor] });
            let descriptor: Retained<AnyObject> = match descriptor {
                Ok(d) if !d.is_null() => unsafe { Retained::retain(d) }.unwrap(),
                _ => {
                    eprintln!("  port[{i}].descriptor threw/nil — skipping");
                    continue;
                }
            };
            // Best-effort conformance + displayClass logging (ROCK proxy may lie).
            if let Some(proto) = renderable_proto {
                let dptr = std::panic::AssertUnwindSafe(Retained::as_ptr(&descriptor));
                let pp = std::panic::AssertUnwindSafe(proto);
                let conforms: Result<bool, _> = objc2::exception::catch(move || unsafe {
                    msg_send![&*{ *dptr }, conformsToProtocol: *pp]
                });
                match conforms {
                    Ok(c) => print!("  port[{i}] renderable={c}"),
                    Err(_) => print!("  port[{i}] renderable=?"),
                }
            } else {
                print!("  port[{i}]");
            }
            let dptr_s = std::panic::AssertUnwindSafe(Retained::as_ptr(&descriptor));
            let dc: Result<u16, _> = objc2::exception::catch(move || unsafe {
                let state: *mut AnyObject = msg_send![&*{ *dptr_s }, state];
                msg_send![&*state, displayClass]
            });
            match dc {
                Ok(c) => println!(" displayClass={c}"),
                Err(_) => println!(" displayClass=?"),
            }

            // Try framebufferSurface then ioSurface.
            let raw: *mut AnyObject = {
                let dptr_f = std::panic::AssertUnwindSafe(Retained::as_ptr(&descriptor));
                let fb: Result<*mut AnyObject, _> = objc2::exception::catch(move || unsafe {
                    msg_send![&*{ *dptr_f }, framebufferSurface]
                });
                match fb {
                    Ok(p) if !p.is_null() => p,
                    _ => {
                        let dptr2 = std::panic::AssertUnwindSafe(Retained::as_ptr(&descriptor));
                        let io: Result<*mut AnyObject, _> =
                            objc2::exception::catch(move || unsafe {
                                msg_send![&*{ *dptr2 }, ioSurface]
                            });
                        io.unwrap_or(null_mut())
                    }
                }
            };
            if raw.is_null() {
                eprintln!("    no surface on this descriptor");
                continue;
            }
            // The getter returns an autoreleased/owned ref; take +1 with retain.
            let surface: Retained<objc2_io_surface::IOSurface> =
                unsafe { Retained::retain(raw.cast()) }.expect("retain surface");
            chosen = Some((descriptor, surface));
            println!("    surface obtained on port[{i}] ✓");
            break;
        }

        let (descriptor, surface) =
            chosen.expect("no descriptor yielded a non-nil framebufferSurface/ioSurface");

        // Introspect: which object actually implements the register* selectors?
        {
            let cls: *const AnyClass = unsafe { msg_send![&*descriptor, class] };
            let cname: Retained<NSString> = unsafe { msg_send![cls, description] };
            println!("\ndescriptor class: {cname}");
            for sel in [
                "registerCallbackWithUUID:damageRectanglesCallback:",
                "registerCallbackWithUUID:ioSurfacesChangeCallback:",
                "registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:",
            ] {
                let s = objc2::runtime::Sel::register(&std::ffi::CString::new(sel).unwrap());
                let r: bool = unsafe { msg_send![&*descriptor, respondsToSelector: s] };
                println!("  descriptor responds to {sel}: {r}");
            }
            // Also check the io client (SimDeviceIOClient) for screen callbacks.
            let io_cls: *const AnyClass = unsafe { msg_send![&*io, class] };
            let io_cname: Retained<NSString> = unsafe { msg_send![io_cls, description] };
            println!("io client class: {io_cname}");
            for sel in [
                "registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:",
                "registerCallbackWithUUID:damageRectanglesCallback:",
            ] {
                let s = objc2::runtime::Sel::register(&std::ffi::CString::new(sel).unwrap());
                let r: bool = unsafe { msg_send![&*io, respondsToSelector: s] };
                println!("  io responds to {sel}: {r}");
            }
        }

        // 9. Geometry + pixel format (immediately).
        let w0 = surface.width();
        let h0 = surface.height();
        let fmt = surface.pixelFormat();
        println!(
            "\nfirst surface: {w0}x{h0}  pixelFormat=0x{:08X} ('{}')",
            fmt,
            fourcc(fmt)
        );

        // 10. Register a damage-rectangles callback to count frames.
        let counter = Arc::new(AtomicU32::new(0));
        let uuid_cls = AnyClass::get(c"NSUUID").expect("NSUUID missing");
        let uuid: Retained<AnyObject> = unsafe { msg_send![uuid_cls, UUID] };

        // Raw pointers cross the exception::catch boundary safely (Retained /
        // RcBlock refs are not UnwindSafe). The objects outlive the catch.
        let desc_ptr: *const AnyObject = &*descriptor;
        let uuid_ptr: *const AnyObject = &*uuid;

        // The descriptor is a ROCKRemoteProxy SimScreen. The two-arg
        // registerCallbackWithUUID:damageRectanglesCallback: throws across the
        // proxy, so use the high-level idb path:
        //   registerScreenCallbacksWithUUID:callbackQueue:frameCallback:
        //     surfacesChangedCallback:propertiesChangedCallback:
        // frameCallback fires once per delivered frame on `callbackQueue`.
        let queue = unsafe { dispatch_get_global_queue(0, 0) };

        let c_frame = counter.clone();
        let frame_block =
            RcBlock::with_encoding::<_, _, _, VoidIdBlock>(move |_surface: *mut AnyObject| {
                c_frame.fetch_add(1, Relaxed);
            });
        let surfaces_block =
            RcBlock::with_encoding::<_, _, _, VoidIdBlock>(move |_surface: *mut AnyObject| {});
        let props_block =
            RcBlock::with_encoding::<_, _, _, VoidIdBlock>(move |_props: *mut AnyObject| {});

        let frame_ptr: *const block2::Block<_> = &*frame_block;
        let surf_ptr: *const block2::Block<_> = &*surfaces_block;
        let props_ptr: *const block2::Block<_> = &*props_block;
        let args = std::panic::AssertUnwindSafe((
            desc_ptr, uuid_ptr, queue, frame_ptr, surf_ptr, props_ptr,
        ));
        let reg: Result<(), _> = objc2::exception::catch(move || unsafe {
            let (d, u, q, f, s, p) = *args;
            let _: () = msg_send![
                &*d,
                registerScreenCallbacksWithUUID: &*u,
                callbackQueue: q,
                frameCallback: &*f,
                surfacesChangedCallback: &*s,
                propertiesChangedCallback: &*p
            ];
        });
        match &reg {
            Ok(()) => println!("registerScreenCallbacks: ok"),
            Err(e) => {
                let m = e
                    .as_ref()
                    .map(|o| exc_str(Retained::as_ptr(o) as *mut AnyObject))
                    .unwrap_or_else(|| "(nil exception)".into());
                panic!("registerScreenCallbacks threw: {m}");
            }
        }

        // ALSO register the per-content-frame damageRectanglesCallback. The
        // screen frameCallback above fires only on surface *replacement*; this
        // one ticks on every content update. It is `void(^)(NSArray*)` — same
        // v16@?0@8 encoding — and likewise needs a signed block or the proxy
        // raises "Block is missing signature field".
        let uuid2: Retained<AnyObject> = unsafe { msg_send![uuid_cls, UUID] };
        let uuid2_ptr: *const AnyObject = &*uuid2;
        let c_dmg = counter.clone();
        let dmg_block =
            RcBlock::with_encoding::<_, _, _, VoidIdBlock>(move |_rects: *mut AnyObject| {
                c_dmg.fetch_add(1, Relaxed);
            });
        let dmg_ptr: *const block2::Block<_> = &*dmg_block;
        let dargs = std::panic::AssertUnwindSafe((desc_ptr, uuid2_ptr, dmg_ptr));
        let reg_dmg: Result<(), _> = objc2::exception::catch(move || unsafe {
            let (d, u, b) = *dargs;
            let _: () =
                msg_send![&*d, registerCallbackWithUUID: &*u, damageRectanglesCallback: &*b];
        });
        println!(
            "register damageRectanglesCallback: {}",
            if reg_dmg.is_ok() { "ok" } else { "threw" }
        );

        // 11. Drive motion on the sim so damage callbacks fire, then capture ~6s.
        println!("\ncapturing for {CAPTURE_SECS}s (driving redraws via simctl)…");
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let motion_stop = stop.clone();
        let motion = std::thread::spawn(move || {
            // Cycle the foreground app to force open/close transition animations
            // (many frames) plus appearance flips (full-screen redraws). These
            // are the cheapest reliable headless animators.
            let apps = [
                "com.apple.Preferences",
                "com.apple.mobilesafari",
                "com.apple.Preferences",
            ];
            let mut i = 0usize;
            let mut dark = true;
            while !motion_stop.load(Relaxed) {
                let appearance = if dark { "dark" } else { "light" };
                let _ = std::process::Command::new("xcrun")
                    .args(["simctl", "ui", TARGET_UDID, "appearance", appearance])
                    .output();
                let _ = std::process::Command::new("xcrun")
                    .args(["simctl", "launch", TARGET_UDID, apps[i % apps.len()]])
                    .output();
                i += 1;
                dark = !dark;
                std::thread::sleep(Duration::from_millis(400));
            }
        });

        // Two independent frame signals:
        //  (a) the damageRectangles callback (event-driven, but CoreSimulator
        //      coalesces aggressively when headless — may under-count), and
        //  (b) the IOSurface `seed`, which increments on every content change.
        // We poll (b) at high frequency as the authoritative headless frame
        // count — it is exactly what an idb-style polling consumer reads, and it
        // proves the framebuffer is updating with no window attached. Tracking
        // the running total of seed deltas (not just transition events) gives
        // the true frame count even when several land between polls.
        let start = Instant::now();
        let seed0 = surface.seed();
        let mut last_seed = seed0;
        let mut seed_frames = 0u64;
        while start.elapsed() < Duration::from_secs(CAPTURE_SECS) {
            std::thread::sleep(Duration::from_millis(8));
            let s = surface.seed();
            if s != last_seed {
                seed_frames += s.wrapping_sub(last_seed) as u64;
                last_seed = s;
            }
        }
        stop.store(true, Relaxed);
        let _ = motion.join();
        let elapsed = start.elapsed().as_secs_f64();

        let cb_frames = counter.load(Relaxed);
        // Authoritative headless frame count = total IOSurface seed increments.
        let frames = seed_frames;

        // 12. Re-read dims (may have changed) + do one BGRA byte read.
        let w = surface.width();
        let h = surface.height();
        let bpr = surface.bytesPerRow() as usize;
        let dense_bytes = (w as usize) * (h as usize) * 4;

        let mut locked_bytes = 0usize;
        let opts = objc2_io_surface::IOSurfaceLockOptions::ReadOnly;
        let lock_ret = surface.lockWithOptions_seed(opts, null_mut());
        if lock_ret == 0 {
            let base = surface.baseAddress().as_ptr() as *const u8;
            // Copy h rows of w*4 stripping bpr padding → dense BGRA.
            let mut dense = Vec::<u8>::with_capacity(dense_bytes);
            let row_len = (w as usize) * 4;
            for row in 0..(h as usize) {
                let src = unsafe { base.add(row * bpr) };
                let slice = unsafe { std::slice::from_raw_parts(src, row_len) };
                dense.extend_from_slice(slice);
            }
            locked_bytes = dense.len();
            surface.unlockWithOptions_seed(opts, null_mut());
        } else {
            eprintln!("lockWithOptions:seed: returned {lock_ret} (non-zero = failed)");
        }

        // 13. Unregister + report.
        unsafe {
            let _: () = msg_send![&*descriptor, unregisterScreenCallbacksWithUUID: &*uuid];
            let _: () =
                msg_send![&*descriptor, unregisterDamageRectanglesCallbackWithUUID: &*uuid2];
        }
        // Restore a sane appearance.
        let _ = std::process::Command::new("xcrun")
            .args(["simctl", "ui", TARGET_UDID, "appearance", "dark"])
            .output();

        println!("\n=== RESULT ===");
        println!(
            "surface: {w}x{h} px   pixelFormat=0x{:08X} ('{}')",
            fmt,
            fourcc(fmt)
        );
        println!(
            "bytesPerRow: {bpr}   dense BGRA/frame: {dense_bytes} bytes ({} KB)",
            dense_bytes / 1024
        );
        println!("one locked read copied: {locked_bytes} bytes");
        println!("surface seed: {seed0} → {last_seed}");
        println!(
            "frames (IOSurface seed deltas): {frames} in {elapsed:.1}s  →  {:.1} fps",
            frames as f64 / elapsed
        );
        println!(
            "frames (damageRectangles callback): {cb_frames}  (CoreSimulator coalesces these when headless)"
        );
        if frames > 0 && w0 > 0 {
            println!("\n✓ HEADLESS framebuffer capture works — {w0}x{h0}, {frames} frames.");
        } else {
            eprintln!("\n⚠️  resolution-or-frames check failed (w0={w0} frames={frames}).");
        }
    }

    /// Render an OSType / FourCC as a 4-char string (e.g. 'BGRA').
    fn fourcc(v: u32) -> String {
        let b = v.to_be_bytes();
        b.iter()
            .map(|&c| if c.is_ascii_graphic() { c as char } else { '.' })
            .collect()
    }
}
