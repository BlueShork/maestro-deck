// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Maestro runner subprocess orchestration.

use std::collections::{HashMap, HashSet};
use std::process::Stdio;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex as AsyncMutex};
use tracing::{debug, info, warn};

use crate::error::{AppError, AppResult};
use crate::process_ext::CommandExtNoWindow;

const EVT_STDOUT: &str = "runner:stdout";
const EVT_STDERR: &str = "runner:stderr";
const EVT_EXIT: &str = "runner:exit";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunnerEvent {
    pub stream: String,
    pub line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunnerExit {
    pub pid: u32,
    pub code: Option<i32>,
}

/// Map of active runner PIDs to their kill-signal sender. The kill signal is
/// consumed by the wait task which owns the `Child` and calls `kill().await`
/// from a `tokio::select!` arm. Entries are removed once the wait task
/// completes (whether the runner exited on its own or was killed).
static RUNNERS: Lazy<AsyncMutex<HashMap<u32, oneshot::Sender<()>>>> =
    Lazy::new(|| AsyncMutex::new(HashMap::new()));

/// Maestro binaries confirmed to support `--driver-host-port`. Caches the
/// (slow, JVM-booting) capability probe in `maestro_supports_driver_host_port`.
static DRIVER_HOST_PORT_OK: Lazy<AsyncMutex<HashSet<String>>> =
    Lazy::new(|| AsyncMutex::new(HashSet::new()));

/// Resolves to the user's `maestro` install — see `crate::tool_paths` for
/// the full priority chain (user override → env → common paths → shell).
fn maestro_bin() -> String {
    crate::tool_paths::maestro_bin()
}

/// Per-run maestro output bundle.
///
/// Since maestro 2.7, `takeScreenshot` / `startRecording` no longer write
/// CWD-relative files: they land in the run's debug bundle, under
/// `<bundle>/<flow>/takeScreenshot/<path>.png`. The bank (and users) expect
/// them next to the flow, where maestro ≤ 2.6 put them (every runner sets the
/// CWD to the flow's directory). So each run gets its own bundle directory,
/// and [`RunOutput::restore_command_outputs`] copies those files back next
/// to the flow once the run ends — before `runner:exit`, which is what
/// triggers the bank comparison.
struct RunOutput {
    bundle: std::path::PathBuf,
    flow_dir: std::path::PathBuf,
}

/// Bundle sub-folders holding files a flow asked for by path.
const COMMAND_OUTPUT_DIRS: [&str; 2] = ["takeScreenshot", "startRecording"];

impl RunOutput {
    fn new(flow_dir: &std::path::Path) -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default();
        let name = format!(
            "{stamp}-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        );
        Self {
            bundle: std::env::temp_dir().join("maestro-deck-runs").join(name),
            flow_dir: flow_dir.to_path_buf(),
        }
    }

    /// `test`-subcommand args pointing maestro's debug bundle at `bundle`.
    /// `--flatten-debug-output` writes it there directly instead of under a
    /// timestamped `.maestro/tests/<date>` sub-folder.
    fn args(&self) -> Vec<std::ffi::OsString> {
        vec![
            "--debug-output".into(),
            self.bundle.clone().into_os_string(),
            "--flatten-debug-output".into(),
        ]
    }

    /// Copy every file under `<bundle>/<flow>/{takeScreenshot,startRecording}/`
    /// to the flow directory, keeping its relative path (`screens/home` →
    /// `<flow_dir>/screens/home.png`). Best-effort: failures are logged.
    fn restore_command_outputs(&self) {
        let Ok(flows) = std::fs::read_dir(&self.bundle) else {
            return;
        };
        for flow in flows.filter_map(Result::ok).map(|e| e.path()) {
            for sub in COMMAND_OUTPUT_DIRS {
                let root = flow.join(sub);
                if root.is_dir() {
                    copy_tree(&root, &root, &self.flow_dir);
                }
            }
        }
    }
}

fn copy_tree(root: &std::path::Path, dir: &std::path::Path, dest: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for path in entries.filter_map(Result::ok).map(|e| e.path()) {
        if path.is_dir() {
            copy_tree(root, &path, dest);
            continue;
        }
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        let target = dest.join(rel);
        if let Some(parent) = target.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::copy(&path, &target) {
            warn!(from = %path.display(), to = %target.display(), error = %e, "could not restore run output");
        }
    }
}

/// Run [`RunOutput::restore_command_outputs`] off the async runtime.
async fn restore_outputs(output: RunOutput) {
    let _ = tokio::task::spawn_blocking(move || output.restore_command_outputs()).await;
}

/// Build the `-e APP_ID=<value>` args for a maestro `test` invocation, or an
/// empty vec when no app id is configured. This lets a single global APP_ID
/// (set in Settings) feed the `${APP_ID}` placeholder users keep in their CI
/// flow files, so those flows run locally without per-file edits. `-e` is a
/// `test`-subcommand option, so callers must insert these args *after* `test`.
fn app_id_env_args(app_id: Option<&str>) -> Vec<String> {
    match app_id.map(str::trim).filter(|s| !s.is_empty()) {
        Some(value) => vec!["-e".to_string(), format!("APP_ID={value}")],
        None => Vec::new(),
    }
}

/// Spawn `maestro --udid <serial> test <flow>` and stream stdout/stderr to
/// the frontend via Tauri events. The PID is returned so the frontend can
/// request a stop.
///
/// `--udid` (not `--device`) is the right flag for a specific physical
/// device serial: in maestro 2.5.x, `--device` was repurposed to mean a
/// device *model* (e.g. `pixel_6`) and silently rejects serials with
/// "Device <serial> was requested, but it is not connected."
pub async fn spawn_runner(
    app: AppHandle,
    serial: &str,
    flow_path: &str,
    app_id: Option<&str>,
    on_exit: Option<Box<dyn FnOnce(AppHandle) + Send + 'static>>,
) -> AppResult<u32> {
    let bin = maestro_bin();
    info!(bin = %bin, serial, flow = %flow_path, "spawning maestro");
    let env_args = app_id_env_args(app_id);
    let flow_dir = std::path::Path::new(flow_path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    // Maestro 2.5.x's session manager calls `dadb.Dadb.list()` which
    // walks every adb-server transport before honoring `--udid` — any
    // offline entry (typically `emulator-5554` ghosts created by adb's
    // periodic emulator-port auto-scan) causes enumeration to fail
    // with `Command failed (...): device offline`, and the test exits
    // with "Device <serial> not connected" even though the intended
    // device is plugged in.
    //
    // Loop disconnect until no offline emulator transport is left or
    // we've spent ~2s trying. adb's auto-scan cycle is also ~2s so
    // racing against a fresh ghost is rare but possible — in practice
    // the user can just click Run again.
    let adb = crate::device::adb::adb_bin();
    for _ in 0..10 {
        let devs = tokio::process::Command::new(&adb)
            .no_window()
            .args(["devices"])
            .output()
            .await;
        let has_offline_emulator = match devs {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                stdout
                    .lines()
                    .any(|l| l.contains("emulator-") && l.contains("offline"))
            }
            Err(_) => false,
        };
        if !has_offline_emulator {
            break;
        }
        for emulator in ["emulator-5554", "emulator-5556", "emulator-5558"] {
            let _ = tokio::process::Command::new(&adb)
                .no_window()
                .args(["disconnect", emulator])
                .output()
                .await;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    let output = RunOutput::new(&flow_dir);
    let mut child = Command::new(&bin)
        .no_window()
        .args(["--udid", serial, "test"])
        .args(output.args())
        .args(&env_args)
        .arg(flow_path)
        .current_dir(&flow_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::RunnerNotFound
            } else {
                AppError::Io(e)
            }
        })?;

    let pid = child.id().ok_or_else(|| {
        AppError::RunnerFailed("spawned child had no PID (already exited)".into())
    })?;

    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        let mut reader = BufReader::new(stdout).lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                debug!(target: "maestro::stdout", "{line}");
                let _ = app.emit(EVT_STDOUT, &line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        let mut reader = BufReader::new(stderr).lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                debug!(target: "maestro::stderr", "{line}");
                let _ = app.emit(EVT_STDERR, &line);
            }
        });
    }

    // Register the kill channel BEFORE spawning the wait task so a quick
    // `stop_flow` after `run_flow` returns can always find the PID.
    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    RUNNERS.lock().await.insert(pid, kill_tx);

    let app_exit = app.clone();
    let on_exit_hook = on_exit;
    tokio::spawn(async move {
        let code = tokio::select! {
            status = child.wait() => status.ok().and_then(|s| s.code()),
            _ = kill_rx => {
                if let Err(e) = child.kill().await {
                    warn!(pid, error = %e, "child kill failed");
                }
                child.wait().await.ok().and_then(|s| s.code())
            }
        };
        RUNNERS.lock().await.remove(&pid);
        restore_outputs(output).await;
        // Fire the optional post-exit hook BEFORE emitting the exit event.
        // The hook may schedule background work (e.g. keeper restart) that
        // we want kicked off as early as possible — the frontend doesn't
        // need to wait for it, since the hook just spawns and returns.
        if let Some(hook) = on_exit_hook {
            hook(app_exit.clone());
        }
        let _ = app_exit.emit(EVT_EXIT, RunnerExit { pid, code });
    });

    Ok(pid)
}

/// Vertical window-chrome allowance for headless web runs. Selenium applies
/// `--screen-size` to the OUTER window, and Chrome (even headless=new)
/// reserves ~143 px of virtual UI — the resulting viewport is that much
/// shorter. Measured live (2026-07-11, Chrome 149: 1200x762 requested →
/// 1200x619 viewport; 1200x905 requested → exactly 1200x762). If Chrome ever
/// changes this, the bank will surface it as a visible dimension mismatch.
const HEADLESS_CHROME_UI_PX: u32 = 143;

/// `--screen-size WxH` args yielding a headless VIEWPORT that matches the
/// interactive session's, so a run renders the SAME responsive layout the
/// flow was authored against (maestro's headless default is 1024x768 — a
/// narrower breakpoint where site content can differ or disappear) and bank
/// captures line up with what the user sees. Empty when dims are unknown.
fn web_screen_size_args(screen_size: Option<(u32, u32)>) -> Vec<String> {
    match screen_size {
        Some((w, h)) if w > 0 && h > 0 => {
            vec![
                "--screen-size".to_string(),
                format!("{w}x{}", h + HEADLESS_CHROME_UI_PX),
            ]
        }
        _ => Vec::new(),
    }
}

/// Spawn `maestro test --headless <flow>` for the web platform — no `--udid`,
/// since Maestro targets the browser via the flow's `url:` header, and no adb
/// emulator-ghost preamble (irrelevant to web). `--headless` keeps the run's
/// Chromium off-screen (web-only flag; the console output is the run's UI);
/// `--screen-size` pins the viewport to the interactive session's.
/// Streams stdout/stderr and emits `runner:exit` exactly like [`spawn_runner`].
pub async fn spawn_web_runner(
    app: AppHandle,
    flow_path: &str,
    app_id: Option<&str>,
    screen_size: Option<(u32, u32)>,
) -> AppResult<u32> {
    let bin = maestro_bin();
    info!(bin = %bin, flow = %flow_path, ?screen_size, "spawning maestro (web, headless)");
    let env_args = app_id_env_args(app_id);
    let size_args = web_screen_size_args(screen_size);
    let flow_dir = std::path::Path::new(flow_path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let output = RunOutput::new(&flow_dir);
    let mut child = Command::new(&bin)
        .no_window()
        // `-p web` is a global flag and must precede the `test` subcommand.
        .args(["-p", "web", "test", "--headless"])
        .args(output.args())
        .args(&size_args)
        .args(&env_args)
        .arg(flow_path)
        .current_dir(&flow_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::RunnerNotFound
            } else {
                AppError::Io(e)
            }
        })?;

    let pid = child.id().ok_or_else(|| {
        AppError::RunnerFailed("spawned child had no PID (already exited)".into())
    })?;

    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        let mut reader = BufReader::new(stdout).lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                debug!(target: "maestro::stdout", "{line}");
                let _ = app.emit(EVT_STDOUT, &line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        let mut reader = BufReader::new(stderr).lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                debug!(target: "maestro::stderr", "{line}");
                let _ = app.emit(EVT_STDERR, &line);
            }
        });
    }

    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    RUNNERS.lock().await.insert(pid, kill_tx);

    let app_exit = app.clone();
    tokio::spawn(async move {
        let code = tokio::select! {
            status = child.wait() => status.ok().and_then(|s| s.code()),
            _ = kill_rx => {
                if let Err(e) = child.kill().await {
                    warn!(pid, error = %e, "child kill failed");
                }
                child.wait().await.ok().and_then(|s| s.code())
            }
        };
        RUNNERS.lock().await.remove(&pid);
        restore_outputs(output).await;
        // Run finished — release the keeper, stop the CDP mirror and hand
        // the canvas back to the (still-warm) keeper preview.
        {
            use tauri::Manager;
            let state = app_exit.state::<crate::state::AppState>();
            state
                .web_run_active
                .store(false, std::sync::atomic::Ordering::SeqCst);
            if let Some(mirror) = state.web_run_mirror_abort.lock().await.take() {
                let _ = mirror.send(());
            }
            // Resume the keeper preview poller (only if none is running —
            // e.g. the user disconnected mid-run and teardown already ran).
            let keeper = state.web_driver.lock().await.clone();
            if let Some(keeper) = keeper {
                let mut slot = state.web_screenshot_abort.lock().await;
                if slot.is_none() {
                    *slot = Some(crate::web_session::spawn_screenshot_poller(
                        app_exit.clone(),
                        keeper,
                    ));
                }
            }
        }
        let _ = app_exit.emit(EVT_EXIT, RunnerExit { pid, code });
    });

    Ok(pid)
}

/// Spawn `maestro --udid <udid> test <flow>` for an iOS simulator. Like
/// [`spawn_runner`] but without the adb emulator-ghost preamble (irrelevant to
/// iOS). The caller stops the driver keeper first so `maestro test` can bring up
/// its own XCTest driver on :22087 without contention. Streams stdout/stderr and
/// emits `runner:exit` exactly like the other runners.
pub async fn spawn_ios_runner(
    app: AppHandle,
    udid: &str,
    flow_path: &str,
    app_id: Option<&str>,
) -> AppResult<u32> {
    let bin = maestro_bin();
    info!(bin = %bin, udid, flow = %flow_path, "spawning maestro (ios)");
    let env_args = app_id_env_args(app_id);
    let flow_dir = std::path::Path::new(flow_path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let output = RunOutput::new(&flow_dir);
    let mut child = Command::new(&bin)
        .no_window()
        .args(["--udid", udid, "test"])
        .args(output.args())
        .args(&env_args)
        .arg(flow_path)
        .current_dir(&flow_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::RunnerNotFound
            } else {
                AppError::Io(e)
            }
        })?;

    let pid = child.id().ok_or_else(|| {
        AppError::RunnerFailed("spawned child had no PID (already exited)".into())
    })?;

    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        let mut reader = BufReader::new(stdout).lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                debug!(target: "maestro::stdout", "{line}");
                let _ = app.emit(EVT_STDOUT, &line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        let mut reader = BufReader::new(stderr).lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                debug!(target: "maestro::stderr", "{line}");
                let _ = app.emit(EVT_STDERR, &line);
            }
        });
    }

    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    RUNNERS.lock().await.insert(pid, kill_tx);

    let app_exit = app.clone();
    tokio::spawn(async move {
        let code = tokio::select! {
            status = child.wait() => status.ok().and_then(|s| s.code()),
            _ = kill_rx => {
                if let Err(e) = child.kill().await {
                    warn!(pid, error = %e, "child kill failed");
                }
                child.wait().await.ok().and_then(|s| s.code())
            }
        };
        RUNNERS.lock().await.remove(&pid);
        restore_outputs(output).await;
        // Run finished — let inspect/tap re-warm the simulator keeper again.
        {
            use tauri::Manager;
            app_exit
                .state::<crate::state::AppState>()
                .ios_sim_run_active
                .store(false, std::sync::atomic::Ordering::SeqCst);
        }
        let _ = app_exit.emit(EVT_EXIT, RunnerExit { pid, code });
    });

    Ok(pid)
}

/// True if the resolved maestro accepts the `--driver-host-port` flag, i.e. it
/// is the patched maestro that can drive a physical device by talking to an
/// already-running XCTest driver (the `maestro-ios-device` bridge).
///
/// We can't just grep `maestro --help`: in patched maestro 2.5.1 the option is
/// registered with `hidden = true`, so it never appears in help output. Instead
/// we probe `maestro --driver-host-port <port> test --help` and treat the flag
/// being accepted (no picocli "Unknown option" / "Unmatched argument") as
/// support. `test --help` short-circuits to help, so nothing is executed and no
/// port is bound.
pub async fn maestro_supports_driver_host_port(bin: &str) -> bool {
    // Probing the flag boots the maestro JVM (~seconds), which stalls every
    // physical-device run. The binary doesn't change mid-session, so cache a
    // confirmed-good bin and skip the probe on subsequent runs. Only `true` is
    // cached — a `false` is re-probed so installing the patched maestro is
    // picked up without a restart.
    if DRIVER_HOST_PORT_OK.lock().await.contains(bin) {
        return true;
    }
    let ok = Command::new(bin)
        .no_window()
        .args(["--driver-host-port", "6001", "test", "--help"])
        .output()
        .await
        .map(|o| {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            );
            !text.contains("Unknown option") && !text.contains("Unmatched argument")
        })
        .unwrap_or(false);
    if ok {
        DRIVER_HOST_PORT_OK.lock().await.insert(bin.to_string());
    }
    ok
}

/// Spawn `maestro --driver-host-port <port> --device <udid> test <flow>` for a
/// physical iOS device. The run REUSES the `maestro-ios-device` bridge's
/// already-running XCTest driver (forwarded on `port`) instead of bringing up
/// its own — so the caller must keep the keeper alive. Requires the
/// devicelab-patched maestro (stock maestro has no `--driver-host-port`); we
/// preflight that flag and surface a clear setup error if it's missing.
pub async fn spawn_ios_device_runner(
    app: AppHandle,
    udid: &str,
    flow_path: &str,
    port: u16,
    app_id: Option<&str>,
) -> AppResult<u32> {
    let bin = maestro_bin();
    if !maestro_supports_driver_host_port(&bin).await {
        return Err(AppError::RunnerFailed(
            "this maestro has no --driver-host-port flag — physical-device flow runs need \
             devicelab's patched maestro (install maestro-ios-device via setup.sh)"
                .into(),
        ));
    }
    let port_str = port.to_string();
    info!(bin = %bin, udid, port, flow = %flow_path, "spawning maestro (ios physical)");
    let env_args = app_id_env_args(app_id);
    let flow_dir = std::path::Path::new(flow_path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let output = RunOutput::new(&flow_dir);
    let mut child = Command::new(&bin)
        .no_window()
        .args(["--driver-host-port", &port_str, "--device", udid, "test"])
        .args(output.args())
        .args(&env_args)
        .arg(flow_path)
        .current_dir(&flow_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::RunnerNotFound
            } else {
                AppError::Io(e)
            }
        })?;

    let pid = child.id().ok_or_else(|| {
        AppError::RunnerFailed("spawned child had no PID (already exited)".into())
    })?;

    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        let mut reader = BufReader::new(stdout).lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                debug!(target: "maestro::stdout", "{line}");
                let _ = app.emit(EVT_STDOUT, &line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        let mut reader = BufReader::new(stderr).lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                debug!(target: "maestro::stderr", "{line}");
                let _ = app.emit(EVT_STDERR, &line);
            }
        });
    }

    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    RUNNERS.lock().await.insert(pid, kill_tx);

    let app_exit = app.clone();
    tokio::spawn(async move {
        let code = tokio::select! {
            status = child.wait() => status.ok().and_then(|s| s.code()),
            _ = kill_rx => {
                if let Err(e) = child.kill().await {
                    warn!(pid, error = %e, "child kill failed");
                }
                child.wait().await.ok().and_then(|s| s.code())
            }
        };
        RUNNERS.lock().await.remove(&pid);
        restore_outputs(output).await;
        let _ = app_exit.emit(EVT_EXIT, RunnerExit { pid, code });
    });

    Ok(pid)
}

pub async fn kill_runner(pid: u32) -> AppResult<()> {
    let tx = RUNNERS.lock().await.remove(&pid);
    match tx {
        Some(tx) => {
            // The receiver may already be dropped if the runner exited in the
            // tiny window between us locking and the wait task finishing —
            // that's fine, send returns Err which we ignore.
            let _ = tx.send(());
            Ok(())
        }
        None => Err(AppError::RunnerFailed(format!("no runner with PID {pid}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_output_args_flatten_into_a_per_run_bundle() {
        let a = RunOutput::new(std::path::Path::new("/flows"));
        let b = RunOutput::new(std::path::Path::new("/flows"));
        assert_ne!(a.bundle, b.bundle, "each run needs its own bundle");
        let args = a.args();
        assert_eq!(args[0], "--debug-output");
        assert_eq!(args[1], a.bundle.as_os_str());
        assert_eq!(args[2], "--flatten-debug-output");
    }

    #[test]
    fn restores_screenshots_and_recordings_next_to_the_flow() {
        // Layout written by maestro 2.10.0 (`--debug-output X
        // --flatten-debug-output`): X/<flow>/takeScreenshot/<path>.png.
        let tmp = tempfile::tempdir().unwrap();
        let bundle = tmp.path().join("bundle");
        let flow_dir = tmp.path().join("flows");
        std::fs::create_dir_all(&flow_dir).unwrap();
        let shots = bundle.join("login").join("takeScreenshot");
        std::fs::create_dir_all(shots.join("screens")).unwrap();
        std::fs::write(shots.join("home-bytel.png"), b"png").unwrap();
        std::fs::write(shots.join("screens").join("cart.png"), b"png2").unwrap();
        let rec = bundle.join("login").join("startRecording");
        std::fs::create_dir_all(&rec).unwrap();
        std::fs::write(rec.join("demo.mp4"), b"mp4").unwrap();
        // Everything else in the bundle stays put.
        std::fs::write(bundle.join("login").join("commands.json"), b"{}").unwrap();
        std::fs::write(flow_dir.join("home-bytel.png"), b"stale").unwrap();

        let out = RunOutput {
            bundle,
            flow_dir: flow_dir.clone(),
        };
        out.restore_command_outputs();

        assert_eq!(
            std::fs::read(flow_dir.join("home-bytel.png")).unwrap(),
            b"png"
        );
        assert_eq!(
            std::fs::read(flow_dir.join("screens").join("cart.png")).unwrap(),
            b"png2"
        );
        assert_eq!(std::fs::read(flow_dir.join("demo.mp4")).unwrap(), b"mp4");
        assert!(!flow_dir.join("commands.json").exists());
    }

    #[test]
    fn restoring_a_missing_bundle_is_a_no_op() {
        let tmp = tempfile::tempdir().unwrap();
        let out = RunOutput {
            bundle: tmp.path().join("never-written"),
            flow_dir: tmp.path().to_path_buf(),
        };
        out.restore_command_outputs();
        assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 0);
    }

    #[test]
    fn web_screen_size_args_pin_the_interactive_viewport() {
        // Height is padded by the window-chrome allowance so the resulting
        // VIEWPORT (not the outer window) matches the interactive session:
        // requesting 1200x905 yields a 1200x762 viewport (measured live).
        assert_eq!(
            web_screen_size_args(Some((1200, 762))),
            vec!["--screen-size".to_string(), "1200x905".to_string()]
        );
        // Unknown or degenerate dims → let maestro use its default.
        assert!(web_screen_size_args(Some((0, 762))).is_empty());
        assert!(web_screen_size_args(None).is_empty());
    }

    #[tokio::test]
    async fn kill_unknown_pid_errors() {
        let res = kill_runner(987_654_321).await;
        assert!(matches!(res, Err(AppError::RunnerFailed(_))));
    }

    #[test]
    fn app_id_env_args_emits_e_flag_when_set() {
        assert_eq!(
            app_id_env_args(Some("com.example.app")),
            vec!["-e".to_string(), "APP_ID=com.example.app".to_string()]
        );
    }

    #[test]
    fn app_id_env_args_trims_whitespace() {
        assert_eq!(
            app_id_env_args(Some("  com.example.app  ")),
            vec!["-e".to_string(), "APP_ID=com.example.app".to_string()]
        );
    }

    #[test]
    fn app_id_env_args_empty_when_none_or_blank() {
        assert!(app_id_env_args(None).is_empty());
        assert!(app_id_env_args(Some("")).is_empty());
        assert!(app_id_env_args(Some("   ")).is_empty());
    }
}
