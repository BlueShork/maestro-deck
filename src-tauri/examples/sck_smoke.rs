// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Live smoke test for the ScreenCaptureKit window-capture core
//! (`maestro_deck_lib::ios_capture`). Captures the iOS Simulator window for a
//! few seconds and reports frames received + effective fps + frame size.
//!
//! Run on macOS with a booted simulator AND the Simulator window visible:
//!   1) `xcrun simctl boot "iPhone 16 Pro"` (or any), then `open -a Simulator`
//!   2) Grant your terminal app Screen Recording:
//!      System Settings → Privacy & Security → Screen & System Audio Recording
//!      → enable Terminal / iTerm (relaunch the terminal after granting).
//!   3) `cargo run --manifest-path src-tauri/Cargo.toml --example sck_smoke`

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("sck_smoke is macOS-only.");
}

#[cfg(target_os = "macos")]
#[tokio::main]
async fn main() {
    use maestro_deck_lib::ios_capture::{
        request_screen_capture, screen_capture_permitted, CaptureSession,
    };
    use std::time::Instant;

    if !screen_capture_permitted() {
        eprintln!("Screen Recording not granted — prompting…");
        request_screen_capture();
        eprintln!(
            "Grant your terminal Screen Recording in System Settings, RELAUNCH the terminal, \
             then re-run. (Permission only takes effect after relaunch.)"
        );
        return;
    }
    println!("Screen Recording: granted ✓");

    println!("Looking for a Simulator window (com.apple.iphonesimulator)…");
    let (session, mut rx) = match CaptureSession::start("com.apple.iphonesimulator", None, 60).await
    {
        Ok(v) => v,
        Err(e) => {
            eprintln!("capture failed: {e}");
            eprintln!(
                "→ Is a simulator booted AND the Simulator window open/visible (not minimized)?"
            );
            return;
        }
    };
    println!("Capture started. Collecting frames for 5s…");

    let start = Instant::now();
    let mut frames = 0u32;
    let mut first_dims: Option<(usize, usize)> = None;
    let mut total_bytes = 0usize;
    while start.elapsed().as_secs() < 5 {
        match tokio::time::timeout(std::time::Duration::from_millis(1500), rx.recv()).await {
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
                eprintln!("(no frame in 1.5s — is the window minimized / off-screen / static?)")
            }
        }
    }
    session.stop().await;

    let secs = start.elapsed().as_secs_f64();
    println!("\n=== RESULT ===");
    println!(
        "frames: {frames} in {secs:.1}s  →  {:.1} fps",
        frames as f64 / secs
    );
    if let Some((w, h)) = first_dims {
        println!(
            "frame size: {w}x{h} px  ({} KB/frame avg)",
            total_bytes / frames.max(1) as usize / 1024
        );
    }
    if frames == 0 {
        eprintln!(
            "\n⚠️  0 frames. Window found but no frames — try: un-minimize the Simulator window, \
                   keep it on-screen, interact with the sim (SCK only emits on content change)."
        );
    } else {
        println!("\n✓ SCK core works — {frames} frames captured.");
    }
}
