// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Live smoke test for the headless iOS-Simulator framebuffer capture core
//! (`maestro_deck_lib::sim_capture`). Attaches to a booted simulator's display
//! IOSurface — fully headless, NO Simulator.app window and NO Screen Recording
//! permission — and reports downscaled frames received + effective fps + size.
//!
//! Unlike `sck_smoke`, this path needs NO NSApplication bootstrap and NO Screen
//! Recording grant: it reads the simulator's IOSurface directly via the
//! CoreSimulator / SimulatorKit private APIs.
//!
//! Run on macOS with the target simulator BOOTED (window need NOT be open):
//!   xcrun simctl boot 172BA2A3-894E-4632-B8DB-C96D87BCFF62   # if shut down
//!   cargo run --manifest-path src-tauri/Cargo.toml --example simfb_smoke

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("simfb_smoke is macOS-only.");
}

#[cfg(target_os = "macos")]
#[tokio::main]
async fn main() {
    use maestro_deck_lib::sim_capture::SimCaptureSession;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    const UDID: &str = "172BA2A3-894E-4632-B8DB-C96D87BCFF62";

    println!("Attaching headlessly to simulator {UDID}…");
    let (session, mut rx) = match SimCaptureSession::start(UDID, 60, 900).await {
        Ok(v) => v,
        Err(e) => {
            eprintln!("attach failed: {e}");
            eprintln!("→ Is the simulator booted? Try: xcrun simctl boot {UDID}");
            return;
        }
    };
    println!("Attached. Driving redraws + collecting frames for ~5s…");

    // Drive motion so the framebuffer keeps changing: flip appearance every
    // ~250ms (forces full-screen redraws). Reset to dark at the end.
    let motion_stop = Arc::new(AtomicBool::new(false));
    let ms = motion_stop.clone();
    let motion = std::thread::spawn(move || {
        let mut dark = false;
        while !ms.load(Ordering::Relaxed) {
            let appearance = if dark { "dark" } else { "light" };
            let _ = std::process::Command::new("xcrun")
                .args(["simctl", "ui", UDID, "appearance", appearance])
                .output();
            dark = !dark;
            std::thread::sleep(Duration::from_millis(250));
        }
    });

    let start = Instant::now();
    let mut frames = 0u32;
    let mut first_dims: Option<(usize, usize)> = None;
    let mut total_bytes = 0usize;
    while start.elapsed().as_secs() < 5 {
        match tokio::time::timeout(Duration::from_millis(1500), rx.recv()).await {
            Ok(Some(f)) => {
                frames += 1;
                total_bytes += f.bgra.len();
                first_dims.get_or_insert((f.width, f.height));
            }
            Ok(None) => {
                eprintln!("frame channel closed early");
                break;
            }
            Err(_) => {
                eprintln!("(no frame in 1.5s — is the sim static / shut down?)")
            }
        }
    }

    motion_stop.store(true, Ordering::Relaxed);
    let _ = motion.join();
    // Restore a sane appearance.
    let _ = std::process::Command::new("xcrun")
        .args(["simctl", "ui", UDID, "appearance", "dark"])
        .output();
    session.stop().await;

    let secs = start.elapsed().as_secs_f64();
    println!("\n=== RESULT ===");
    println!(
        "frames: {frames} in {secs:.1}s  →  {:.1} fps",
        frames as f64 / secs
    );
    if let Some((w, h)) = first_dims {
        println!(
            "downscaled frame size: {w}x{h} px  ({} KB/frame avg)",
            total_bytes / frames.max(1) as usize / 1024
        );
    }
    if frames == 0 {
        eprintln!("\n⚠️  0 frames. Surface attached but seed never advanced — drive more motion.");
    } else {
        println!("\n✓ HEADLESS simulator framebuffer capture works — {frames} downscaled frames.");
    }
}
