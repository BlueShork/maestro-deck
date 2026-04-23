//! scrcpy server orchestration.
//!
//! We ship scrcpy-server.jar under `resources/scrcpy/` and push it to the device
//! at [`DEVICE_JAR_PATH`]. The server is started with `app_process` and a set of
//! CLI-style "key=value" args passed after the main class name, per scrcpy's
//! [protocol](https://github.com/Genymobile/scrcpy/blob/master/doc/develop.md).
//!
//! End-to-end connection requires a real device (not available in this env), so
//! the streaming loop is left as a documented TODO. The argument builder and
//! adb tunnel helpers ARE implemented and unit-tested.

use std::path::PathBuf;

use tracing::info;

use crate::device::adb;
use crate::error::AppResult;

pub mod stream;

pub const SCRCPY_VERSION: &str = "2.7";
pub const DEFAULT_PORT: u16 = 27183;
pub const DEVICE_JAR_PATH: &str = "/data/local/tmp/scrcpy-server.jar";
pub const SCID: &str = "12345678"; // arbitrary 8-hex session id; scrcpy uses this to namespace sockets
pub const SOCKET_NAME: &str = "scrcpy";

/// Parameters passed to the server JAR. Field names mirror scrcpy 2.x options.
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

/// Build the `adb shell` argv used to start scrcpy-server.
pub fn build_server_argv(opts: &ServerOptions) -> Vec<String> {
    vec![
        "CLASSPATH=/data/local/tmp/scrcpy-server.jar".into(),
        "app_process".into(),
        "/".into(),
        "com.genymobile.scrcpy.Server".into(),
        SCRCPY_VERSION.into(),
        format!("scid={SCID}"),
        format!("log_level=info"),
        format!("max_size={}", opts.max_size),
        format!("max_fps={}", opts.max_fps),
        format!("video_bit_rate={}", opts.video_bit_rate),
        format!("tunnel_forward={}", opts.tunnel_forward),
        format!("audio={}", opts.audio),
        format!("control={}", opts.control),
    ]
}

/// Local path to the bundled scrcpy-server.jar. In a real build this comes from
/// Tauri's resource bundle; here we return the repo-relative path used at dev time.
pub fn local_jar_path() -> PathBuf {
    PathBuf::from("resources/scrcpy/scrcpy-server.jar")
}

pub fn push_server(serial: &str) -> AppResult<()> {
    let jar = local_jar_path();
    let jar_str = jar.to_string_lossy();
    info!(%jar_str, "pushing scrcpy-server.jar");
    adb::push(serial, &jar_str, DEVICE_JAR_PATH)
}

pub fn create_tunnel(serial: &str, port: u16) -> AppResult<()> {
    let local = format!("tcp:{port}");
    let remote = format!("localabstract:{SOCKET_NAME}_{SCID}");
    adb::forward(serial, &local, &remote)
}

pub fn start_server(serial: &str) -> AppResult<()> {
    let opts = ServerOptions::default();
    let argv = build_server_argv(&opts);
    let cmd = argv.join(" ");
    // Actual streaming requires spawning this asynchronously and reading from the
    // tunnel; we issue the command so a connected device would begin emitting.
    adb::exec_shell(serial, &cmd)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argv_contains_required_fields() {
        let argv = build_server_argv(&ServerOptions::default());
        assert!(argv.iter().any(|a| a == "com.genymobile.scrcpy.Server"));
        assert!(argv.iter().any(|a| a == SCRCPY_VERSION));
        assert!(argv.iter().any(|a| a.starts_with("scid=")));
        assert!(argv.iter().any(|a| a.starts_with("max_fps=")));
    }

    #[test]
    fn argv_reflects_options() {
        let argv = build_server_argv(&ServerOptions {
            max_size: 720,
            max_fps: 30,
            video_bit_rate: 4_000_000,
            tunnel_forward: true,
            audio: false,
            control: false,
        });
        assert!(argv.contains(&"max_size=720".to_string()));
        assert!(argv.contains(&"max_fps=30".to_string()));
        assert!(argv.contains(&"video_bit_rate=4000000".to_string()));
        assert!(argv.contains(&"control=false".to_string()));
    }
}
