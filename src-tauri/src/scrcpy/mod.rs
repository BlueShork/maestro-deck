//! scrcpy server orchestration.
//!
//! We push scrcpy-server.jar to the device, open an `adb forward` tunnel,
//! and spawn the server as a non-blocking child of `adb shell`. The SCID
//! is randomized per session so reconnects don't collide on the abstract
//! socket name.

use std::path::PathBuf;
use std::process::Stdio;

use tokio::process::{Child, Command};
use tracing::info;

use crate::device::adb;
use crate::error::{AppError, AppResult};

pub mod stream;

pub const SCRCPY_VERSION: &str = "2.7";
pub const DEFAULT_PORT: u16 = 27183;
pub const DEVICE_JAR_PATH: &str = "/data/local/tmp/scrcpy-server.jar";
pub const SOCKET_NAME: &str = "scrcpy";

/// Generate a fresh 8-hex-char SCID for a new session.
pub fn random_scid() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let rand_part = std::process::id() ^ nanos;
    format!("{:08x}", rand_part & 0x7FFF_FFFF)
}

#[derive(Debug, Clone)]
pub struct ServerOptions {
    pub max_size: u32,
    pub max_fps: u32,
    pub video_bit_rate: u32,
    pub tunnel_forward: bool,
    pub audio: bool,
    pub control: bool,
}

impl Default for ServerOptions {
    fn default() -> Self {
        Self {
            max_size: 1080,
            max_fps: 60,
            video_bit_rate: 8_000_000,
            tunnel_forward: true,
            audio: false,
            control: true,
        }
    }
}

pub fn build_server_argv(opts: &ServerOptions, scid: &str) -> Vec<String> {
    vec![
        "CLASSPATH=/data/local/tmp/scrcpy-server.jar".into(),
        "app_process".into(),
        "/".into(),
        "com.genymobile.scrcpy.Server".into(),
        SCRCPY_VERSION.into(),
        format!("scid={scid}"),
        "log_level=info".into(),
        format!("max_size={}", opts.max_size),
        format!("max_fps={}", opts.max_fps),
        format!("video_bit_rate={}", opts.video_bit_rate),
        format!("tunnel_forward={}", opts.tunnel_forward),
        format!("audio={}", opts.audio),
        format!("control={}", opts.control),
    ]
}

pub fn local_jar_path() -> AppResult<PathBuf> {
    let candidates = [
        PathBuf::from("resources/scrcpy-server-v2.7.jar"),
        PathBuf::from("resources/scrcpy/scrcpy-server.jar"),
        PathBuf::from("src-tauri/resources/scrcpy-server-v2.7.jar"),
        PathBuf::from("../Resources/resources/scrcpy-server-v2.7.jar"),
    ];
    for p in &candidates {
        if p.exists() {
            return Ok(p.clone());
        }
    }
    Err(AppError::ScrcpyFailed(format!(
        "scrcpy-server jar not found. Tried: {:?}",
        candidates
    )))
}

pub fn push_server(serial: &str) -> AppResult<()> {
    let jar = local_jar_path()?;
    let jar_str = jar.to_string_lossy();
    info!(%jar_str, "pushing scrcpy-server.jar");
    adb::push(serial, &jar_str, DEVICE_JAR_PATH)
}

pub fn create_tunnel(serial: &str, port: u16, scid: &str) -> AppResult<()> {
    let local = format!("tcp:{port}");
    let remote = format!("localabstract:{SOCKET_NAME}_{scid}");
    adb::forward(serial, &local, &remote)
}

pub fn remove_tunnel(serial: &str, port: u16) -> AppResult<()> {
    adb::forward_remove(serial, &format!("tcp:{port}"))
}

/// Best-effort kill of any leftover scrcpy server on the device. Errors are
/// swallowed because "no matching process" is the normal case.
pub fn pkill_scrcpy(serial: &str) {
    let _ = adb::exec_shell(serial, "pkill -f com.genymobile.scrcpy.Server");
}

/// Spawn scrcpy-server as a detached child of `adb shell`. Does NOT wait for
/// the server to exit — the caller stores the [`Child`] so it can be killed
/// on disconnect.
pub fn spawn_server(serial: &str, scid: &str) -> AppResult<Child> {
    let opts = ServerOptions::default();
    let cmd = build_server_argv(&opts, scid).join(" ");
    info!(serial, scid, "spawning scrcpy server");
    let child = Command::new("adb")
        .args(["-s", serial, "shell", &cmd])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::AdbNotFound
            } else {
                AppError::Io(e)
            }
        })?;
    Ok(child)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argv_contains_required_fields() {
        let argv = build_server_argv(&ServerOptions::default(), "abcd1234");
        assert!(argv.iter().any(|a| a == "com.genymobile.scrcpy.Server"));
        assert!(argv.iter().any(|a| a == SCRCPY_VERSION));
        assert!(argv.iter().any(|a| a == "scid=abcd1234"));
        assert!(argv.iter().any(|a| a.starts_with("max_fps=")));
    }

    #[test]
    fn argv_reflects_options() {
        let argv = build_server_argv(
            &ServerOptions {
                max_size: 720,
                max_fps: 30,
                video_bit_rate: 4_000_000,
                tunnel_forward: true,
                audio: false,
                control: false,
            },
            "deadbeef",
        );
        assert!(argv.contains(&"max_size=720".to_string()));
        assert!(argv.contains(&"max_fps=30".to_string()));
        assert!(argv.contains(&"video_bit_rate=4000000".to_string()));
        assert!(argv.contains(&"control=false".to_string()));
    }

    #[test]
    fn scid_is_8_hex_chars() {
        let s = random_scid();
        assert_eq!(s.len(), 8);
        assert!(s.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
