// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Headless iOS-Simulator framebuffer capture via CoreSimulator / SimulatorKit
//! private APIs (the idb / FBSimulatorControl technique).
//!
//! Attaches to a *booted* simulator's live display `IOSurface` with NO
//! `Simulator.app` window open and NO Screen Recording permission, then streams
//! its pixels as downscaled, tightly-packed BGRA [`Frame`]s on a bounded async
//! channel. This is the low-level capture core for the iOS-Simulator live
//! preview; it is intentionally NOT wired into the Tauri command surface yet, so
//! the public API is `#[allow(dead_code)]`.
//!
//! The whole module is gated `#[cfg(target_os = "macos")]` (also enforced at the
//! crate level via `lib.rs`) so non-mac builds never pull the objc2 stack.
//!
//! ## How it works
//! The proven call sequence (see `examples/simfb_probe.rs`):
//!   dlopen CoreSimulator + SimulatorKit → `SimServiceContext` →
//!   `defaultDeviceSet` → find `SimDevice` by UDID → `device.io` → `ioPorts` →
//!   per-port `descriptor` → the descriptor whose `framebufferSurface` is non-nil
//!   (preferring `displayClass == 0`, the main display).
//!
//! The resulting `IOSurface` is read BGRA under `lockWithOptions:seed:` with the
//! row padding (`bytesPerRow`) stripped. New frames are detected by **polling the
//! surface `seed()`**, which increments on every content change — the
//! event-driven damage callbacks coalesce unreliably when headless, so we don't
//! rely on them.
//!
//! ## Threading model
//! All the CoreSimulator / SimulatorKit objc objects are `!Send` and must never
//! cross an `.await`, so they live entirely on a dedicated **`std::thread`** (the
//! poll thread) that owns them for its whole lifetime. That thread locks the
//! surface, and whenever the seed advances it copies + downscales the pixels and
//! `try_send`s a [`Frame`] on a bounded `tokio::mpsc` channel — *dropping* the
//! frame when the consumer is behind (channel full), so the capture pipeline
//! never stalls. Holding the device IO / descriptor / surface `Retained` refs on
//! that thread also keeps the CoreSimulator IO client alive (and the device
//! booted) until [`SimCaptureSession::stop`].
//!
//! Because every objc object stays on the poll thread, [`SimCaptureSession`]
//! itself only holds `Send` things (an `Arc<AtomicBool>` stop flag + a
//! `JoinHandle`), so it is `Send` with no `unsafe impl`.

#![cfg(target_os = "macos")]
// The public capture API is exercised by a later increment that wires it into
// the Tauri command surface; until then the items below are legitimately unused.
#![allow(dead_code)]

use std::ffi::c_void;
use std::panic::AssertUnwindSafe;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject};
use objc2_foundation::{NSArray, NSString};
use objc2_io_surface::{IOSurface, IOSurfaceLockOptions};
use tokio::sync::mpsc;
use tracing::{debug, warn};

use crate::error::{AppError, AppResult};
use crate::ios_capture::Frame;

/// Bounded capacity of the frame channel. The poll thread drops frames when full
/// rather than blocking — matches `ios_capture::FRAME_CHANNEL_CAPACITY`.
const FRAME_CHANNEL_CAPACITY: usize = 4;

/// Developer dir hosting the private frameworks. We resolve it from
/// `xcode-select -p` at runtime, falling back to the default install path.
const DEFAULT_DEVELOPER_DIR: &str = "/Applications/Xcode.app/Contents/Developer";

extern "C" {
    fn dlopen(path: *const libc::c_char, flags: libc::c_int) -> *mut c_void;

    /// Raw IOSurface base-address accessor. Unlike `IOSurface::baseAddress()`
    /// (and the crate's `IOSurfaceGetBaseAddress` wrapper), which return a
    /// non-null `NonNull<c_void>` and **panic** when the surface has no
    /// CPU-accessible backing, the C function returns a plain (nullable)
    /// pointer — NULL for a surface whose pixels live only on the GPU. The
    /// IOSurface framework is already linked (via `objc2-io-surface`), so this
    /// symbol resolves. See `copy_downscaled`.
    fn IOSurfaceGetBaseAddress(buffer: *const c_void) -> *mut c_void;
}
const RTLD_NOW: libc::c_int = 0x2;

/// An active headless simulator framebuffer capture session.
///
/// The CoreSimulator / SimulatorKit objc objects live on the poll thread; this
/// struct only holds the stop flag and the thread handle, so it is `Send`. Drop
/// it (or call [`stop`](Self::stop)) to tear the capture down — that releases the
/// surface/device refs (they are dropped when the poll thread exits).
pub struct SimCaptureSession {
    udid: String,
    stop: Arc<AtomicBool>,
    // `Option` so `stop()` can take + join the handle; `Drop` joins any leftover.
    handle: Option<JoinHandle<()>>,
}

impl SimCaptureSession {
    /// Resolve the booted simulator `udid`, attach to its display `IOSurface`,
    /// and spawn a thread that polls the surface seed at ~`fps` Hz; on each new
    /// frame it copies the BGRA pixels (downscaled so the longer side `<=`
    /// `max_dim`) and `try_send`s a [`Frame`] on a bounded channel (dropping when
    /// full — never blocks). Returns the live session + the frame receiver.
    /// Fully headless (no Simulator.app window, no Screen Recording grant).
    pub async fn start(
        udid: &str,
        fps: u32,
        max_dim: u32,
    ) -> AppResult<(Self, mpsc::Receiver<Frame>)> {
        let udid = udid.to_owned();
        let fps = fps.max(1);
        let max_dim = max_dim.max(1);

        let (tx, rx) = mpsc::channel::<Frame>(FRAME_CHANNEL_CAPACITY);
        let stop = Arc::new(AtomicBool::new(false));

        // Resolve + attach to the surface on the poll thread itself (the objc
        // refs are !Send), but surface any attach failure back to the caller via
        // a one-shot. Once attached the thread loops until `stop` is set.
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<AppResult<()>>();
        let thread_stop = stop.clone();
        let thread_udid = udid.clone();

        let handle = std::thread::Builder::new()
            .name("sim-capture-poll".into())
            .spawn(move || {
                let attached = match attach(&thread_udid) {
                    Ok(a) => {
                        let _ = ready_tx.send(Ok(()));
                        a
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                poll_loop(attached, tx, thread_stop, fps, max_dim);
            })
            .map_err(|e| {
                AppError::ScreenCaptureFailed(format!("spawn sim-capture poll thread: {e}"))
            })?;

        match ready_rx.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                // Attach failed; thread already returned. Join to be tidy.
                let _ = handle.join();
                return Err(e);
            }
            Err(_) => {
                let _ = handle.join();
                return Err(AppError::ScreenCaptureFailed(
                    "sim-capture poll thread exited before signalling readiness".into(),
                ));
            }
        }

        debug!("sim-capture attached to {udid} (fps={fps}, max_dim={max_dim})");

        Ok((
            SimCaptureSession {
                udid,
                stop,
                handle: Some(handle),
            },
            rx,
        ))
    }

    /// Stop the poll thread and release the surface/device refs. Setting the stop
    /// flag makes the poll loop exit on its next tick; joining the thread drops
    /// the `Retained` IOSurface / descriptor / device-IO refs it owns (releasing
    /// the CoreSimulator IO client). Idempotent.
    pub async fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
        // The handle is joined in `Drop`; `&self` can't take it. Joining is cheap
        // (the loop wakes within one frame interval) and happens on Drop, which
        // the caller reaches right after this in normal use. We block here on a
        // spawn_blocking-free path only via Drop, so just signal here.
    }
}

impl Drop for SimCaptureSession {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            // The poll loop checks `stop` once per frame interval, so this joins
            // within ~1 frame. Dropping the joined thread's stack releases all
            // the objc `Retained` refs (surface/descriptor/device IO).
            let _ = h.join();
        }
    }
}

/// The objc objects that must stay alive (and on one thread) for the capture to
/// keep working. Holding `descriptor` + `_io` + `_device` keeps the CoreSimulator
/// IO client (and the booted display) alive; `surface` is what we read pixels
/// from.
struct Attached {
    surface: Retained<IOSurface>,
    // Kept alive so the live IO client / display backing isn't torn down. We
    // could re-fetch `framebufferSurface` from `descriptor` on surface
    // replacement; v1 holds the initial surface (the probe did this).
    descriptor: Retained<AnyObject>,
    _io: Retained<AnyObject>,
    _device: Retained<AnyObject>,
}

/// dlopen the private frameworks (idempotent — repeated dlopens are cheap and the
/// handle is process-global). Returns an error rather than panicking.
fn load_frameworks(developer_dir: &str) -> AppResult<()> {
    let load = |path: String| -> AppResult<()> {
        let c = std::ffi::CString::new(path.clone())
            .map_err(|e| AppError::ScreenCaptureFailed(format!("bad framework path: {e}")))?;
        // SAFETY: `c` is a valid NUL-terminated C string; `dlopen` with RTLD_NOW
        // either returns a handle or NULL. We never deref the handle.
        let h = unsafe { dlopen(c.as_ptr(), RTLD_NOW) };
        if h.is_null() {
            return Err(AppError::ScreenCaptureFailed(format!(
                "dlopen failed for {path}"
            )));
        }
        Ok(())
    };
    load("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator".to_owned())?;
    load(format!(
        "{developer_dir}/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"
    ))?;
    Ok(())
}

/// Resolve the active developer dir via `xcode-select -p`, defaulting to the
/// standard Xcode install path on any failure.
fn developer_dir() -> String {
    std::process::Command::new("xcode-select")
        .arg("-p")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_DEVELOPER_DIR.to_owned())
}

/// Render an `id*` error (NSError or any object) to a String for logging.
fn err_str(err: *mut AnyObject) -> String {
    if err.is_null() {
        return "(nil)".into();
    }
    let ep = AssertUnwindSafe(err);
    objc2::exception::catch(move || unsafe {
        let s: Retained<NSString> = msg_send![&*{ *ep }, localizedDescription];
        s.to_string()
    })
    .unwrap_or_else(|_| "(no localizedDescription)".into())
}

/// Resolve the booted simulator by `udid` and attach to its display IOSurface.
/// Runs entirely on the poll thread (all returned refs are `!Send`).
fn attach(udid: &str) -> AppResult<Attached> {
    let dev_dir = developer_dir();
    load_frameworks(&dev_dir)?;

    // SimServiceContext for our developer dir.
    let ctx_cls = AnyClass::get(c"SimServiceContext")
        .ok_or_else(|| AppError::ScreenCaptureFailed("SimServiceContext class missing".into()))?;
    let dev_dir_ns = NSString::from_str(&dev_dir);
    let mut err: *mut AnyObject = null_mut();
    // SAFETY: `+sharedServiceContextForDeveloperDir:error:` takes an NSString and
    // an `id*` out-error (NOT `NSError**` directly — the binding is `id*`). We
    // pass a live NSString and a stack `id` slot, then inspect `err`.
    // `Option<Retained<_>>` (NOT `Retained<_>`): a bare `Retained` return PANICS
    // when the message yields nil, and with `panic = "abort"` that aborts the whole
    // app from this capture thread. Treat nil as a recoverable error instead.
    let ctx: Option<Retained<AnyObject>> = unsafe {
        msg_send![ctx_cls, sharedServiceContextForDeveloperDir: &*dev_dir_ns, error: &mut err]
    };
    if !err.is_null() {
        return Err(AppError::ScreenCaptureFailed(format!(
            "sharedServiceContextForDeveloperDir failed: {}",
            err_str(err)
        )));
    }
    let ctx = ctx.ok_or_else(|| {
        AppError::ScreenCaptureFailed("sharedServiceContextForDeveloperDir returned nil".into())
    })?;

    // Default device set.
    let mut err2: *mut AnyObject = null_mut();
    // SAFETY: `-defaultDeviceSetWithError:` takes an `id*` out-error; same idiom.
    let set: Option<Retained<AnyObject>> =
        unsafe { msg_send![&*ctx, defaultDeviceSetWithError: &mut err2] };
    if !err2.is_null() {
        return Err(AppError::ScreenCaptureFailed(format!(
            "defaultDeviceSetWithError failed: {}",
            err_str(err2)
        )));
    }
    let set =
        set.ok_or_else(|| AppError::ScreenCaptureFailed("defaultDeviceSet returned nil".into()))?;

    // Find the SimDevice by UDID (case-insensitive on UUIDString).
    // SAFETY: `-availableDevices` returns a live NSArray of SimDevice objects.
    let devices: Option<Retained<NSArray<AnyObject>>> =
        unsafe { msg_send![&*set, availableDevices] };
    let devices = devices
        .ok_or_else(|| AppError::ScreenCaptureFailed("availableDevices returned nil".into()))?;
    let count = devices.count();
    let mut device: Option<Retained<AnyObject>> = None;
    for i in 0..count {
        let d = devices.objectAtIndex(i);
        // SAFETY: `-UDID` returns an NSUUID; `-UUIDString` an NSString. A nil from
        // either (a half-initialised device) → skip it rather than panic.
        let s: Option<Retained<NSString>> = unsafe {
            let u: Option<Retained<AnyObject>> = msg_send![&*d, UDID];
            match u {
                Some(u) => msg_send![&*u, UUIDString],
                None => None,
            }
        };
        let Some(s) = s else { continue };
        if s.to_string().eq_ignore_ascii_case(udid) {
            device = Some(d);
            break;
        }
    }
    let device = device.ok_or_else(|| {
        AppError::ScreenCaptureFailed(format!(
            "simulator {udid} not found among {count} available devices"
        ))
    })?;

    // SimDeviceState: 0=Creating 1=Shutdown 2=Booting 3=Booted 4=ShuttingDown.
    // SAFETY: `-state` returns the device's NSUInteger state.
    let state: u64 = unsafe { msg_send![&*device, state] };
    if state != 3 {
        return Err(AppError::ScreenCaptureFailed(format!(
            "simulator {udid} is not Booted (state={state}); `xcrun simctl boot {udid}` first"
        )));
    }

    // device.io → ioPorts. Both `Option` (not bare `Retained`): a freshly-booted
    // sim can briefly have no IO client / ioPorts, and a nil there would panic →
    // abort. Surface it as a recoverable error so the caller can retry/fall back.
    // SAFETY: `-io` returns the device's IO client; `-ioPorts` a live NSArray.
    let io: Option<Retained<AnyObject>> = unsafe { msg_send![&*device, io] };
    let io = io.ok_or_else(|| {
        AppError::ScreenCaptureFailed(format!(
            "simulator {udid} has no IO client (still booting?)"
        ))
    })?;
    let ports: Option<Retained<NSArray<AnyObject>>> = unsafe { msg_send![&*io, ioPorts] };
    let ports = ports.ok_or_else(|| {
        AppError::ScreenCaptureFailed(format!("simulator {udid} exposed no ioPorts"))
    })?;
    let nports = ports.count();

    // Pick the descriptor whose `framebufferSurface` is non-nil, preferring the
    // main display (`state.displayClass == 0`). Fragile cross-proxy sends are
    // wrapped in `objc2::exception::catch` with raw pointers (Retained isn't
    // UnwindSafe) — the probe's exact technique.
    let mut chosen: Option<(Retained<AnyObject>, Retained<IOSurface>, u16)> = None;

    for i in 0..nports {
        let port = ports.objectAtIndex(i);
        let port_ptr = AssertUnwindSafe(Retained::as_ptr(&port));
        // SAFETY: `-descriptor` may throw across the ROCK proxy; caught. The port
        // outlives the catch (held by `ports`).
        let descriptor: Result<*mut AnyObject, _> =
            objc2::exception::catch(move || unsafe { msg_send![&*{ *port_ptr }, descriptor] });
        let descriptor: Retained<AnyObject> = match descriptor {
            // SAFETY: `-descriptor` returns an autoreleased object; +1 retain it.
            Ok(d) if !d.is_null() => match unsafe { Retained::retain(d) } {
                Some(r) => r,
                None => continue,
            },
            _ => continue,
        };

        // displayClass (best-effort; the proxy may not respond).
        let dptr = AssertUnwindSafe(Retained::as_ptr(&descriptor));
        // SAFETY: `-state` then `-displayClass` may throw across the proxy; caught.
        let display_class: u16 = objc2::exception::catch(move || unsafe {
            let st: *mut AnyObject = msg_send![&*{ *dptr }, state];
            msg_send![&*st, displayClass]
        })
        .unwrap_or(u16::MAX);

        // framebufferSurface, falling back to ioSurface.
        let dptr_f = AssertUnwindSafe(Retained::as_ptr(&descriptor));
        // SAFETY: `-framebufferSurface` may throw / return nil; caught.
        let fb: Result<*mut AnyObject, _> = objc2::exception::catch(move || unsafe {
            msg_send![&*{ *dptr_f }, framebufferSurface]
        });
        let raw: *mut AnyObject = fb
            .ok()
            .filter(|p: &*mut AnyObject| !p.is_null())
            .or_else(|| {
                let dptr2 = AssertUnwindSafe(Retained::as_ptr(&descriptor));
                // SAFETY: `-ioSurface` fallback; may throw / return nil; caught.
                let io: Result<*mut AnyObject, _> =
                    objc2::exception::catch(move || unsafe { msg_send![&*{ *dptr2 }, ioSurface] });
                io.ok().filter(|p: &*mut AnyObject| !p.is_null())
            })
            .unwrap_or(null_mut());

        if raw.is_null() {
            continue;
        }
        // SAFETY: the surface getter returns an owned/autoreleased ref; +1 retain
        // to keep it alive. `raw` is a valid IOSurface* here (non-null, checked).
        let surface: Retained<IOSurface> = match unsafe { Retained::retain(raw.cast()) } {
            Some(s) => s,
            None => continue,
        };

        let prefer = display_class == 0;
        let already_main = chosen.as_ref().map(|(_, _, dc)| *dc == 0).unwrap_or(false);
        if chosen.is_none() || (prefer && !already_main) {
            chosen = Some((descriptor, surface, display_class));
            if prefer {
                break; // main display — best match, stop early.
            }
        }
    }

    let (descriptor, surface, _dc) = chosen.ok_or_else(|| {
        AppError::ScreenCaptureFailed(format!(
            "no descriptor on {udid} yielded a framebuffer IOSurface ({nports} ioPorts)"
        ))
    })?;

    Ok(Attached {
        surface,
        descriptor,
        _io: io,
        _device: device,
    })
}

/// The poll loop body — owns all the objc refs (via `attached`) on the poll
/// thread. Locks the surface, and whenever `seed()` advances, copies +
/// downscales the BGRA pixels and `try_send`s a [`Frame`] (dropping on a full
/// channel). Exits when `stop` is set.
fn poll_loop(
    attached: Attached,
    tx: mpsc::Sender<Frame>,
    stop: Arc<AtomicBool>,
    fps: u32,
    max_dim: u32,
) {
    let surface = attached.surface;
    let interval = Duration::from_millis((1000 / fps.max(1)).max(1) as u64);

    // Force the first lock to produce a frame (seed may already equal anything).
    let mut last_seed = surface.seed().wrapping_sub(1);

    while !stop.load(Ordering::Relaxed) {
        let seed = surface.seed();
        if seed != last_seed {
            last_seed = seed;
            if let Some(frame) = copy_downscaled(&surface, max_dim) {
                // Never block: drop the frame if the consumer is behind (full) or
                // gone (receiver dropped → we keep the device alive until stop()).
                let _ = tx.try_send(frame);
            }
        }
        std::thread::sleep(interval);
    }

    debug!("sim-capture poll loop exiting; releasing surface/device refs");
    // `attached.descriptor` / `_io` / `_device` drop here with `surface`,
    // releasing the CoreSimulator IO client.
    drop(surface);
    drop(attached.descriptor);
}

/// Lock the surface read-only and copy its BGRA pixels, nearest-neighbour
/// downscaled so the longer side is `<= max_dim`. Strips the `bytesPerRow`
/// padding so the output [`Frame::bgra`] is dense (`width * height * 4`). Returns
/// `None` if the lock fails or the base address is null (skip this frame).
fn copy_downscaled(surface: &IOSurface, max_dim: u32) -> Option<Frame> {
    let src_w = surface.width() as usize;
    let src_h = surface.height() as usize;
    if src_w == 0 || src_h == 0 {
        return None;
    }

    // Nearest-neighbour step: sample every `step`-th pixel so max(w,h)/step <=
    // max_dim. step >= 1 always (no upscaling).
    let longer = src_w.max(src_h) as u32;
    let step = longer.div_ceil(max_dim).max(1) as usize;
    let out_w = src_w.div_ceil(step);
    let out_h = src_h.div_ceil(step);

    let opts = IOSurfaceLockOptions::ReadOnly;
    // SAFETY: read-only lock; we copy under the lock and unlock on every path out
    // (both the early-return and the success path below).
    let lock_ret = surface.lockWithOptions_seed(opts, null_mut());
    if lock_ret != 0 {
        warn!("sim-capture lockWithOptions:seed: returned {lock_ret} (non-zero = failed); skipping frame");
        return None;
    }

    // Read the base address via the raw C accessor, NOT `surface.baseAddress()`:
    // the latter returns `NonNull<c_void>` and PANICS when the surface has no
    // CPU-accessible backing (a transient GPU-only state seen under sustained
    // live capture). With `panic = "abort"` that panic aborts the whole app — the
    // crash this guards against. A null base just means "skip this frame".
    // SAFETY: `surface` is a live, locked IOSurface; its pointer is a valid
    // IOSurfaceRef for `IOSurfaceGetBaseAddress`.
    let base =
        unsafe { IOSurfaceGetBaseAddress((surface as *const IOSurface).cast()) } as *const u8;
    if base.is_null() {
        warn!("sim-capture: locked surface has a null base address (GPU-only frame); skipping");
        surface.unlockWithOptions_seed(opts, null_mut());
        return None;
    }
    let bpr = surface.bytesPerRow() as usize;

    let mut bgra = vec![0u8; out_w * out_h * 4];
    // SAFETY: `base` points to `src_h * bpr` valid bytes for the lock's duration.
    // For each sampled (sx, sy) we read 4 bytes at `sx*4 < src_w*4 <= bpr`, so the
    // read stays within row `sy < src_h`. Indices are bounded by the loop ranges.
    unsafe {
        for oy in 0..out_h {
            let sy = (oy * step).min(src_h - 1);
            let row = base.add(sy * bpr);
            let dst_row = oy * out_w * 4;
            for ox in 0..out_w {
                let sx = (ox * step).min(src_w - 1);
                let src_px = row.add(sx * 4);
                let dst = dst_row + ox * 4;
                std::ptr::copy_nonoverlapping(src_px, bgra.as_mut_ptr().add(dst), 4);
            }
        }
    }

    surface.unlockWithOptions_seed(opts, null_mut());

    Some(Frame {
        width: out_w,
        height: out_h,
        bgra,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn developer_dir_is_nonempty() {
        // Resolves via xcode-select or the default; always a usable path.
        assert!(!developer_dir().is_empty());
    }

    #[test]
    fn err_str_handles_null() {
        assert_eq!(err_str(null_mut()), "(nil)");
    }

    /// Manual repro: attaches to the currently-booted simulator and prints the
    /// result. Ignored by default (needs Xcode + a booted sim). Run with:
    ///   cargo test --manifest-path src-tauri/Cargo.toml attach_booted -- --ignored --nocapture
    /// A clean `Ok` or `Err(...)` means no crash; a panic reproduces the bug.
    #[test]
    #[ignore]
    fn attach_booted_does_not_panic() {
        let out = std::process::Command::new("xcrun")
            .args(["simctl", "list", "devices", "booted"])
            .output()
            .expect("run simctl");
        let text = String::from_utf8_lossy(&out.stdout);
        let udid = text
            .lines()
            .find(|l| l.contains("Booted"))
            .and_then(|l| l.split('(').nth(1))
            .and_then(|s| s.split(')').next())
            .map(|s| s.trim().to_owned())
            .expect("a booted simulator UDID");
        eprintln!("attaching to booted sim {udid}");
        let res = attach(&udid);
        eprintln!("attach result: {:?}", res.as_ref().map(|_| "Ok(Attached)"));
        // Whatever happens, attach must not panic — Ok or Err are both fine.
    }

    /// Manual repro of the FULL capture path (the `sim-capture-poll` thread):
    /// `start()` → poll a few frames through `poll_loop`/`copy_downscaled`.
    /// Run with:
    ///   cargo test --manifest-path src-tauri/Cargo.toml capture_booted -- --ignored --nocapture
    #[test]
    #[ignore]
    fn capture_booted_frames_does_not_panic() {
        let out = std::process::Command::new("xcrun")
            .args(["simctl", "list", "devices", "booted"])
            .output()
            .expect("run simctl");
        let text = String::from_utf8_lossy(&out.stdout);
        let udid = text
            .lines()
            .find(|l| l.contains("Booted"))
            .and_then(|l| l.split('(').nth(1))
            .and_then(|s| s.split(')').next())
            .map(|s| s.trim().to_owned())
            .expect("a booted simulator UDID");

        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        rt.block_on(async move {
            // Mirror the SCK-upgrade churn: repeatedly start a capture, pull a few
            // live frames, then tear it down (drops the descriptor/surface proxies
            // on the poll thread) — the exact teardown the real app does when it
            // swaps the headless IOSurface preview for ScreenCaptureKit.
            // Mirror the real preview params (ios_session::preview SIM_FPS/MAX_DIM)
            // and pull a few live frames through poll_loop/copy_downscaled.
            let (session, mut rx) = SimCaptureSession::start(&udid, 30, 700)
                .await
                .expect("start capture");
            for n in 0..10 {
                match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
                    Ok(Some(f)) => {
                        eprintln!(
                            "frame {n}: {}x{} ({} bytes)",
                            f.width,
                            f.height,
                            f.bgra.len()
                        )
                    }
                    Ok(None) => break,
                    Err(_) => eprintln!("frame {n}: timeout"),
                }
            }
            session.stop().await;
            eprintln!("done, no panic");
        });
    }
}
