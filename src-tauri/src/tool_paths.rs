// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Resolution + persistence for external CLI binaries (`adb`, `maestro`).
//!
//! macOS GUI apps inherit a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`),
//! so Homebrew, Android Studio, asdf/mise, and `~/.maestro/bin` are all
//! invisible. This module resolves each tool through five levels:
//!
//!   1. **User override** — explicit path saved by the user via Settings
//!      (`tool_paths.json` in the platform's app config directory).
//!   2. **Env var** — `ADB_BIN` / `MAESTRO_BIN`.
//!   3. **Common install paths** — Homebrew, Android Studio, official
//!      installer locations.
//!   4. **Login shell PATH** — spawn `$SHELL -ilc 'command -v <tool>'`.
//!   5. **Bare name fallback** — last-ditch; the call site surfaces a
//!      `NotFound` error with a setup hint.
//!
//! Resolution is cached behind a `RwLock` so the user can change the path
//! at runtime via the IPC commands and the next call re-resolves without
//! restarting the app.
//!
//! Frontend talks to this module via the `get_tool_paths` /
//! `set_tool_paths` Tauri commands.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::RwLock;
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

use crate::error::{AppError, AppResult};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/// Persisted user-supplied overrides for tool paths. All fields default to
/// `None` so the resolver falls through to env / common paths / shell.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ToolPaths {
    #[serde(default)]
    pub adb: Option<String>,
    #[serde(default)]
    pub maestro: Option<String>,
    #[serde(default)]
    pub iproxy: Option<String>,
    /// Apple Team ID used to code-sign the iOS XCTest runner via `maestro studio`
    /// (simulators) or `maestro-ios-device` (physical devices).
    #[serde(default)]
    pub apple_team_id: Option<String>,
    /// `maestro-ios-device` bridge binary (devicelab) used to build/run the
    /// XCTest runner + port-forward for physical iOS devices.
    #[serde(default)]
    pub maestro_ios_device: Option<String>,
}

/// Path of the JSON file we persist user overrides to. Per-OS conventional
/// app-data directory; created lazily on write.
fn config_file() -> Option<PathBuf> {
    let dir = if cfg!(target_os = "macos") {
        dirs_home()?.join("Library/Application Support/com.maestro-deck")
    } else if cfg!(target_os = "linux") {
        // XDG_CONFIG_HOME, falling back to ~/.config.
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| dirs_home().unwrap_or_default().join(".config"))
            .join("maestro-deck")
    } else if cfg!(target_os = "windows") {
        // %APPDATA% — already roams per Microsoft conventions.
        std::env::var_os("APPDATA")
            .map(PathBuf::from)?
            .join("maestro-deck")
    } else {
        return None;
    };
    Some(dir.join("tool_paths.json"))
}

fn load_overrides() -> ToolPaths {
    let Some(path) = config_file() else {
        return ToolPaths::default();
    };
    let Ok(bytes) = fs::read(&path) else {
        return ToolPaths::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_else(|e| {
        warn!(error = %e, ?path, "tool_paths.json corrupt, ignoring");
        ToolPaths::default()
    })
}

fn save_overrides(paths: &ToolPaths) -> AppResult<()> {
    let Some(file) = config_file() else {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "no app-config dir on this platform",
        )));
    };
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(AppError::Io)?;
    }
    let json = serde_json::to_vec_pretty(paths)
        .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))?;
    fs::write(&file, json).map_err(AppError::Io)?;
    debug!(?file, "tool_paths.json written");
    Ok(())
}

// ---------------------------------------------------------------------------
// Resolution cache
// ---------------------------------------------------------------------------

#[derive(Default)]
struct ResolvedCache {
    adb: Option<String>,
    maestro: Option<String>,
    iproxy: Option<String>,
    maestro_ios_device: Option<String>,
}

static CACHE: Lazy<RwLock<ResolvedCache>> = Lazy::new(|| RwLock::new(ResolvedCache::default()));

fn invalidate_cache() {
    let mut c = CACHE.write().unwrap();
    c.adb = None;
    c.maestro = None;
    c.iproxy = None;
    c.maestro_ios_device = None;
}

// ---------------------------------------------------------------------------
// Public API — binary resolution
// ---------------------------------------------------------------------------

const ADB_DEFAULT: &str = "adb";
const MAESTRO_DEFAULT: &str = "maestro";
const IPROXY_DEFAULT: &str = "iproxy";
const DEVICECTL_DEFAULT: &str = "devicectl";
const MAESTRO_IOS_DEVICE_DEFAULT: &str = "maestro-ios-device";

pub fn adb_bin() -> String {
    if let Some(cached) = CACHE.read().unwrap().adb.clone() {
        return cached;
    }
    let resolved = resolve_tool(
        "adb",
        "ADB_BIN",
        ADB_DEFAULT,
        load_overrides().adb.as_deref(),
        &adb_common_paths(),
    );
    CACHE.write().unwrap().adb = Some(resolved.clone());
    resolved
}

/// devicectl ships inside Xcode; `xcrun -f devicectl` prints its absolute path.
pub fn devicectl_bin() -> String {
    if let Ok(out) = Command::new("xcrun").args(["-f", "devicectl"]).output() {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !p.is_empty() && Path::new(&p).is_file() {
                return p;
            }
        }
    }
    DEVICECTL_DEFAULT.to_string()
}

pub fn maestro_bin() -> String {
    if let Some(cached) = CACHE.read().unwrap().maestro.clone() {
        return cached;
    }
    let resolved = resolve_tool(
        "maestro",
        "MAESTRO_BIN",
        MAESTRO_DEFAULT,
        load_overrides().maestro.as_deref(),
        &maestro_common_paths(),
    );
    CACHE.write().unwrap().maestro = Some(resolved.clone());
    resolved
}

pub fn iproxy_bin() -> String {
    if let Some(cached) = CACHE.read().unwrap().iproxy.clone() {
        return cached;
    }
    let resolved = resolve_tool(
        "iproxy",
        "IPROXY_BIN",
        IPROXY_DEFAULT,
        load_overrides().iproxy.as_deref(),
        &iproxy_common_paths(),
    );
    CACHE.write().unwrap().iproxy = Some(resolved.clone());
    resolved
}

/// `maestro-ios-device` bridge binary (devicelab). Installs alongside `maestro`
/// (same dir as `which maestro`), so it shares maestro's common paths.
pub fn maestro_ios_device_bin() -> String {
    if let Some(cached) = CACHE.read().unwrap().maestro_ios_device.clone() {
        return cached;
    }
    let resolved = resolve_tool(
        "maestro-ios-device",
        "MAESTRO_IOS_DEVICE_BIN",
        MAESTRO_IOS_DEVICE_DEFAULT,
        load_overrides().maestro_ios_device.as_deref(),
        &maestro_ios_device_common_paths(),
    );
    CACHE.write().unwrap().maestro_ios_device = Some(resolved.clone());
    resolved
}

/// User-configured Apple Team ID (or None). The keeper passes it to
/// `maestro studio --apple-team-id` (simulators) or `maestro-ios-device
/// --team-id` (physical); if None, maestro uses its own config.
pub fn apple_team_id() -> Option<String> {
    load_overrides()
        .apple_team_id
        .filter(|s| !s.trim().is_empty())
}

// ---------------------------------------------------------------------------
// Resolution priority chain
// ---------------------------------------------------------------------------

fn resolve_tool(
    tool: &str,
    env_var: &str,
    default_bare: &str,
    user_override: Option<&str>,
    common_paths: &[PathBuf],
) -> String {
    // 1. User override (set via Settings UI).
    if let Some(p) = user_override {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            if Path::new(trimmed).is_file() {
                info!(tool, path = %trimmed, "resolved from user override");
                return trimmed.to_string();
            } else {
                warn!(tool, path = %trimmed, "user override does not exist, falling through");
            }
        }
    }

    // 2. Env var.
    if let Ok(p) = std::env::var(env_var) {
        let p = p.trim().to_string();
        if !p.is_empty() {
            info!(tool, path = %p, env = env_var, "resolved from env var");
            return p;
        }
    }

    // 3. Common install paths.
    if let Some(p) = common_paths.iter().find(|p| p.is_file()) {
        info!(tool, path = %p.display(), "resolved from common path");
        return p.to_string_lossy().into_owned();
    }

    // 4. Login shell PATH.
    if let Some(p) = probe_login_shell(tool) {
        info!(tool, path = %p, "resolved via login shell PATH");
        return p;
    }

    // 5. Bare name. The call site will surface NotFound with a setup hint.
    debug!(tool, "resolution failed, falling back to bare name");
    default_bare.to_string()
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn adb_common_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if cfg!(target_os = "macos") {
        out.push(PathBuf::from("/opt/homebrew/bin/adb"));
        out.push(PathBuf::from("/usr/local/bin/adb"));
        if let Some(home) = dirs_home() {
            out.push(home.join("Library/Android/sdk/platform-tools/adb"));
        }
    } else if cfg!(target_os = "linux") {
        out.push(PathBuf::from("/usr/local/bin/adb"));
        out.push(PathBuf::from("/usr/bin/adb"));
        if let Some(home) = dirs_home() {
            out.push(home.join("Android/Sdk/platform-tools/adb"));
        }
    } else if cfg!(target_os = "windows") {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            out.push(PathBuf::from(local).join("Android/Sdk/platform-tools/adb.exe"));
        }
        if let Some(home) = dirs_home() {
            out.push(home.join("AppData/Local/Android/Sdk/platform-tools/adb.exe"));
        }
    }
    out
}

fn iproxy_common_paths() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/opt/homebrew/bin/iproxy"),
        PathBuf::from("/usr/local/bin/iproxy"),
        PathBuf::from("/usr/bin/iproxy"),
    ]
}

fn maestro_ios_device_common_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if cfg!(target_os = "macos") {
        if let Some(home) = dirs_home() {
            out.push(home.join(".maestro/bin/maestro-ios-device"));
        }
        out.push(PathBuf::from("/opt/homebrew/bin/maestro-ios-device"));
        out.push(PathBuf::from("/usr/local/bin/maestro-ios-device"));
    }
    out
}

fn maestro_common_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if cfg!(target_os = "macos") || cfg!(target_os = "linux") {
        // The official curl-installer drops the binary in ~/.maestro/bin.
        if let Some(home) = dirs_home() {
            out.push(home.join(".maestro/bin/maestro"));
        }
        out.push(PathBuf::from("/opt/homebrew/bin/maestro"));
        out.push(PathBuf::from("/usr/local/bin/maestro"));
        out.push(PathBuf::from("/usr/bin/maestro"));
    } else if cfg!(target_os = "windows") {
        if let Some(home) = dirs_home() {
            out.push(home.join(".maestro/bin/maestro.bat"));
            out.push(home.join(".maestro/bin/maestro.cmd"));
            out.push(home.join(".maestro/bin/maestro.exe"));
        }
    }
    out
}

fn probe_login_shell(tool: &str) -> Option<String> {
    if cfg!(target_os = "windows") {
        return None;
    }

    let shell = std::env::var("SHELL").ok()?;
    // -i -l -c: interactive login shell so .zshrc / .bash_profile run.
    // We also bound execution time so a slow corporate rc file doesn't hang
    // the resolver (and therefore the app) for long.
    let cmd = format!("command -v {}", tool);
    let mut child = Command::new(&shell)
        .args(["-ilc", &cmd])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .ok()?;

    let deadline = std::time::Instant::now() + Duration::from_millis(3000);
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) if std::time::Instant::now() >= deadline => {
                let _ = child.kill();
                warn!(tool, "login-shell probe timed out after 3s");
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => return None,
        }
    }

    let output = child.wait_with_output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() || !Path::new(&path).is_file() {
        return None;
    }
    Some(path)
}

// ---------------------------------------------------------------------------
// IPC — get / set user overrides
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ToolPathsView {
    /// What the user has explicitly set in Settings (may be `None`).
    pub overrides: ToolPaths,
    /// What the resolver actually returns right now (may be the bare name
    /// like `"adb"` if nothing was found).
    pub resolved_adb: String,
    pub resolved_maestro: String,
    pub resolved_iproxy: String,
    pub resolved_maestro_ios_device: String,
}

#[tauri::command]
pub fn get_tool_paths() -> ToolPathsView {
    ToolPathsView {
        overrides: load_overrides(),
        resolved_adb: adb_bin(),
        resolved_maestro: maestro_bin(),
        resolved_iproxy: iproxy_bin(),
        resolved_maestro_ios_device: maestro_ios_device_bin(),
    }
}

/// Write user overrides to disk and invalidate the in-memory cache so the
/// next `*_bin()` call picks up the new value. Empty / blank strings mean
/// "clear the override".
#[tauri::command]
pub fn set_tool_paths(
    adb: Option<String>,
    maestro: Option<String>,
    iproxy: Option<String>,
    apple_team_id: Option<String>,
    maestro_ios_device: Option<String>,
) -> AppResult<ToolPathsView> {
    fn normalize(p: Option<String>) -> Option<String> {
        p.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }
    let new = ToolPaths {
        adb: normalize(adb),
        maestro: normalize(maestro),
        iproxy: normalize(iproxy),
        apple_team_id: normalize(apple_team_id),
        maestro_ios_device: normalize(maestro_ios_device),
    };
    save_overrides(&new)?;
    invalidate_cache();
    Ok(get_tool_paths())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_override_wins_when_file_exists() {
        // /bin/sh exists on every Unix; use it as a stand-in.
        #[cfg(unix)]
        {
            let resolved = resolve_tool(
                "shtest",
                "NEVER_SET_ENV_FOR_TEST",
                "shtest",
                Some("/bin/sh"),
                &[PathBuf::from("/nonexistent/path")],
            );
            assert_eq!(resolved, "/bin/sh");
        }
    }

    #[test]
    fn user_override_falls_through_when_file_missing() {
        let resolved = resolve_tool(
            "shtest",
            "NEVER_SET_ENV_FOR_TEST_2",
            "default-bare",
            Some("/this/path/does/not/exist"),
            &[],
        );
        // No env, no common paths, login shell will fail → bare default.
        assert_eq!(resolved, "default-bare");
    }

    #[test]
    fn common_paths_used_when_no_override_or_env() {
        #[cfg(unix)]
        {
            let resolved = resolve_tool(
                "shtest",
                "NEVER_SET_ENV_FOR_TEST_3",
                "default-bare",
                None,
                &[PathBuf::from("/bin/sh")],
            );
            assert_eq!(resolved, "/bin/sh");
        }
    }

    #[test]
    fn empty_override_is_treated_as_unset() {
        let normalize =
            |p: Option<String>| p.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        assert_eq!(normalize(Some("".into())), None);
        assert_eq!(normalize(Some("   ".into())), None);
        assert_eq!(normalize(Some("/tmp/x".into())), Some("/tmp/x".into()));
    }

    #[test]
    fn tool_paths_round_trips_new_fields() {
        let tp = ToolPaths {
            adb: None,
            maestro: None,
            iproxy: Some("/opt/homebrew/bin/iproxy".into()),
            apple_team_id: Some("ABCDE12345".into()),
            maestro_ios_device: Some("/opt/homebrew/bin/maestro-ios-device".into()),
        };
        let json = serde_json::to_string(&tp).unwrap();
        let back: ToolPaths = serde_json::from_str(&json).unwrap();
        assert_eq!(back.iproxy.as_deref(), Some("/opt/homebrew/bin/iproxy"));
        assert_eq!(back.apple_team_id.as_deref(), Some("ABCDE12345"));
        assert_eq!(
            back.maestro_ios_device.as_deref(),
            Some("/opt/homebrew/bin/maestro-ios-device")
        );
    }

    #[test]
    fn legacy_tool_paths_json_still_loads() {
        let json = r#"{"adb":"/x/adb","maestro":"/y/maestro"}"#;
        let tp: ToolPaths = serde_json::from_str(json).unwrap();
        assert_eq!(tp.adb.as_deref(), Some("/x/adb"));
        assert_eq!(tp.iproxy, None);
        assert_eq!(tp.apple_team_id, None);
    }
}
