//! ADB binary wrapper.

use std::process::Command;

use tracing::{debug, warn};

use super::{Device, DeviceListEntry, DeviceState};
use crate::error::{AppError, AppResult};
use crate::process_ext::CommandExtNoWindow;

/// Resolved adb path. Delegates to the shared resolver in
/// `crate::tool_paths` which handles the user override, env var, common
/// paths, and login-shell fallbacks consistently with `maestro_bin()`.
pub fn adb_bin() -> String {
    crate::tool_paths::adb_bin()
}

fn run_adb(args: &[&str]) -> AppResult<String> {
    let bin = adb_bin();
    debug!(?args, bin = %bin, "running adb");

    let output = Command::new(&bin)
        .no_window()
        .args(args)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::AdbNotFound
            } else {
                AppError::Io(e)
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::AdbFailed(stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

pub fn list_devices() -> AppResult<Vec<Device>> {
    let stdout = run_adb(&["devices", "-l"])?;
    let entries = parse_devices_l(&stdout);

    let mut devices = Vec::new();
    for entry in entries {
        match entry.state {
            DeviceState::Device => match get_device_info(&entry.serial) {
                Ok(d) => devices.push(d),
                Err(e) => warn!(serial = %entry.serial, error = ?e, "failed to fetch device info"),
            },
            DeviceState::Unauthorized => {
                return Err(AppError::DeviceUnauthorized(entry.serial.clone()));
            }
            other => {
                debug!(serial = %entry.serial, state = ?other, "skipping non-ready device");
            }
        }
    }

    Ok(devices)
}

pub fn get_device_info(serial: &str) -> AppResult<Device> {
    let model = exec_shell(serial, "getprop ro.product.model")?
        .trim()
        .to_string();
    let android_version = exec_shell(serial, "getprop ro.build.version.release")?
        .trim()
        .to_string();
    let size_raw = exec_shell(serial, "wm size")?;
    let (screen_width, screen_height) = parse_wm_size(&size_raw).unwrap_or((0, 0));

    Ok(Device {
        serial: serial.to_string(),
        model,
        android_version,
        screen_width,
        screen_height,
    })
}

pub fn exec_shell(serial: &str, cmd: &str) -> AppResult<String> {
    run_adb(&["-s", serial, "shell", cmd])
}

pub fn push(serial: &str, src: &str, dst: &str) -> AppResult<()> {
    run_adb(&["-s", serial, "push", src, dst])?;
    Ok(())
}

pub fn forward(serial: &str, local: &str, remote: &str) -> AppResult<()> {
    run_adb(&["-s", serial, "forward", local, remote])?;
    Ok(())
}

pub fn forward_remove(serial: &str, local: &str) -> AppResult<()> {
    run_adb(&["-s", serial, "forward", "--remove", local])?;
    Ok(())
}

pub fn pull(serial: &str, src: &str, dst: &str) -> AppResult<()> {
    run_adb(&["-s", serial, "pull", src, dst])?;
    Ok(())
}

/// Parse `adb devices -l` output. Format per line:
///   <serial>\s+<state>(\s+<key:value>)*
/// First line is the "List of devices attached" header.
pub fn parse_devices_l(stdout: &str) -> Vec<DeviceListEntry> {
    let mut out = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("List of devices") || line.starts_with('*') {
            continue;
        }

        let mut parts = line.split_whitespace();
        let serial = match parts.next() {
            Some(s) => s.to_string(),
            None => continue,
        };
        let state_raw = match parts.next() {
            Some(s) => s,
            None => continue,
        };

        let mut entry = DeviceListEntry {
            serial,
            state: DeviceState::parse(state_raw),
            model: None,
            product: None,
            device: None,
            transport_id: None,
        };

        for tok in parts {
            if let Some((k, v)) = tok.split_once(':') {
                match k {
                    "model" => entry.model = Some(v.to_string()),
                    "product" => entry.product = Some(v.to_string()),
                    "device" => entry.device = Some(v.to_string()),
                    "transport_id" => entry.transport_id = Some(v.to_string()),
                    _ => {}
                }
            }
        }

        out.push(entry);
    }
    out
}

/// Parse `wm size` output, e.g. "Physical size: 1080x2400" or with override.
pub fn parse_wm_size(stdout: &str) -> Option<(u32, u32)> {
    let mut last: Option<(u32, u32)> = None;
    for line in stdout.lines() {
        if let Some(rest) = line.split_once(':').map(|(_, v)| v.trim()) {
            if let Some((w, h)) = rest.split_once('x') {
                if let (Ok(w), Ok(h)) = (w.trim().parse(), h.trim().parse()) {
                    last = Some((w, h));
                }
            }
        }
    }
    last
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_empty_devices_list() {
        let out = "List of devices attached\n\n";
        assert!(parse_devices_l(out).is_empty());
    }

    #[test]
    fn parses_single_authorized_device() {
        let out = "List of devices attached\n\
                   R58M12345A             device usb:1-2 product:beyond1lte model:SM_G973F device:beyond1 transport_id:3\n";
        let entries = parse_devices_l(out);
        assert_eq!(entries.len(), 1);
        let e = &entries[0];
        assert_eq!(e.serial, "R58M12345A");
        assert_eq!(e.state, DeviceState::Device);
        assert_eq!(e.model.as_deref(), Some("SM_G973F"));
        assert_eq!(e.product.as_deref(), Some("beyond1lte"));
        assert_eq!(e.device.as_deref(), Some("beyond1"));
        assert_eq!(e.transport_id.as_deref(), Some("3"));
    }

    #[test]
    fn parses_multiple_devices_with_mixed_state() {
        let out = "List of devices attached\n\
                   ABCDEF unauthorized\n\
                   12345  device model:Pixel_6 transport_id:1\n\
                   ZZZZZ  offline\n";
        let entries = parse_devices_l(out);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].state, DeviceState::Unauthorized);
        assert_eq!(entries[1].state, DeviceState::Device);
        assert_eq!(entries[1].model.as_deref(), Some("Pixel_6"));
        assert_eq!(entries[2].state, DeviceState::Offline);
    }

    #[test]
    fn parses_devices_with_daemon_banner() {
        let out = "* daemon not running; starting now at tcp:5037 *\n\
                   * daemon started successfully *\n\
                   List of devices attached\n\
                   emulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a\n";
        let entries = parse_devices_l(out);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].serial, "emulator-5554");
        assert_eq!(entries[0].model.as_deref(), Some("sdk_gphone64_arm64"));
    }

    #[test]
    fn parses_wm_size_basic() {
        let out = "Physical size: 1080x2400\n";
        assert_eq!(parse_wm_size(out), Some((1080, 2400)));
    }

    #[test]
    fn parses_wm_size_with_override() {
        let out = "Physical size: 1440x3088\nOverride size: 1080x2316\n";
        assert_eq!(parse_wm_size(out), Some((1080, 2316)));
    }

    #[test]
    fn parses_wm_size_invalid_returns_none() {
        assert_eq!(parse_wm_size("garbage\n"), None);
    }

    #[test]
    fn device_state_parses_known() {
        assert_eq!(DeviceState::parse("device"), DeviceState::Device);
        assert_eq!(
            DeviceState::parse("unauthorized"),
            DeviceState::Unauthorized
        );
        assert_eq!(DeviceState::parse("offline"), DeviceState::Offline);
        assert_eq!(DeviceState::parse("recovery"), DeviceState::Recovery);
        assert_eq!(DeviceState::parse("bootloader"), DeviceState::Bootloader);
        assert_eq!(DeviceState::parse("garbage"), DeviceState::Unknown);
    }
}
