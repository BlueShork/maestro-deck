//! Install and keep current the `maestro-ios-device` bridge (our fork,
//! BlueShork/maestro-ios-device) that drives physical iPhones.
//!
//! The bridge is two things that both go stale on their own: the binary in
//! `~/.maestro/bin`, and the physical-device patch its `setup` writes into the
//! maestro install (jars + XCTest runner). An app update that moves maestro to a
//! new version reinstalls stock jars, and an older bridge only knows older
//! maestro versions. [`ensure_current`] checks both before every physical-device
//! session and reinstalls when either is off, so users never have to.

use std::path::PathBuf;

use once_cell::sync::Lazy;

use tokio::sync::Mutex as AsyncMutex;
use tracing::info;

use crate::error::{AppError, AppResult};

/// Oldest bridge release that supports the maestro version the app ships
/// (`REQUIRED_MAESTRO`, 2.10.0). v1.x only patches maestro 2.5.1.
const REQUIRED_BRIDGE: (u32, u32, u32) = (2, 0, 0);

const RELEASE_URL: &str =
    "https://github.com/BlueShork/maestro-ios-device/releases/latest/download";

/// One install at a time: a connect and a run racing on a stale bridge must
/// not both download it and run `setup` over the same maestro install.
static INSTALL_LOCK: Lazy<AsyncMutex<()>> = Lazy::new(|| AsyncMutex::new(()));

/// `maestro-ios-device vX.Y.Z[-suffix]` → (X, Y, Z). Takes the first line of
/// `--version`, which is followed by a banner.
pub fn parse_version(output: &str) -> Option<(u32, u32, u32)> {
    let first = output.lines().next()?;
    let version = first.split_whitespace().nth(1)?.trim_start_matches('v');
    let core = version.split(['-', '+']).next()?;
    let mut parts = core.split('.').map(|p| p.parse::<u32>().ok());
    Some((parts.next()??, parts.next()??, parts.next()??))
}

/// Version of the installed bridge, or None if it is missing or too old to
/// report one in this format.
pub async fn installed_version() -> Option<(u32, u32, u32)> {
    if !crate::tool_paths::maestro_ios_device_installed() {
        return None;
    }
    let out = tokio::process::Command::new(crate::tool_paths::maestro_ios_device_bin())
        .arg("--version")
        .output()
        .await
        .ok()?;
    parse_version(&String::from_utf8_lossy(&out.stdout))
}

/// True if the installed bridge is at least [`REQUIRED_BRIDGE`].
pub async fn is_current() -> bool {
    installed_version()
        .await
        .is_some_and(|v| v >= REQUIRED_BRIDGE)
}

/// Make sure the bridge is installed, recent enough, and that the maestro the
/// app runs carries its patch; (re)install otherwise. `on_install` runs just
/// before an install starts, so the caller can tell the user why it waits.
pub async fn ensure_current(on_install: impl FnOnce()) -> AppResult<()> {
    if !cfg!(target_os = "macos") {
        return Err(AppError::Other("physical iOS support is macOS-only".into()));
    }
    let _guard = INSTALL_LOCK.lock().await;
    let maestro = crate::tool_paths::maestro_bin();
    if is_current().await && crate::runner::maestro_has_ios_device_patch(&maestro).await {
        return Ok(());
    }
    let version = installed_version().await;
    info!(
        ?version,
        "iPhone bridge missing, outdated or maestro unpatched — reinstalling"
    );
    on_install();
    install_locked().await?;
    if !crate::runner::maestro_has_ios_device_patch(&maestro).await {
        return Err(AppError::IosCommandFailed(
            "the iPhone bridge installed, but maestro still isn't patched — reinstall it from \
             Settings → Physical iPhone"
                .into(),
        ));
    }
    Ok(())
}

/// Download the latest bridge and run its `setup`. Returns the binary's path.
pub async fn install() -> AppResult<String> {
    if !cfg!(target_os = "macos") {
        return Err(AppError::Other("physical iOS support is macOS-only".into()));
    }
    let _guard = INSTALL_LOCK.lock().await;
    install_locked().await
}

async fn install_locked() -> AppResult<String> {
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "amd64",
        other => {
            return Err(AppError::Other(format!(
                "no maestro-ios-device build for this architecture ({other})"
            )))
        }
    };
    let url = format!("{RELEASE_URL}/maestro-ios-device-darwin-{arch}");
    info!(%url, "downloading maestro-ios-device bridge");

    let bytes = reqwest::Client::builder()
        .build()
        .map_err(|e| AppError::Other(format!("http client: {e}")))?
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("download maestro-ios-device: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("download maestro-ios-device: {e}")))?
        .bytes()
        .await
        .map_err(|e| AppError::Other(format!("read maestro-ios-device: {e}")))?;

    let home =
        std::env::var_os("HOME").ok_or_else(|| AppError::Other("no HOME directory".into()))?;
    let dir = PathBuf::from(home).join(".maestro/bin");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(AppError::Io)?;
    let dest = dir.join("maestro-ios-device");
    // Write next to it and rename over it: overwriting an executable in place
    // (an update, maybe while an old bridge still runs) leaves macOS with a
    // stale code signature for that file, and the next launch is SIGKILLed.
    let tmp = dir.join("maestro-ios-device.download");
    tokio::fs::write(&tmp, &bytes).await.map_err(AppError::Io)?;
    // chmod +x — Unix-only. Install is refused off macOS above; the `cfg` just
    // keeps this compiling on Windows (no `PermissionsExt` there).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))
            .await
            .map_err(AppError::Io)?;
    }
    tokio::fs::rename(&tmp, &dest).await.map_err(AppError::Io)?;

    // `setup` fetches the XCTest runner + patched maestro jars into ~/.maestro.
    // No device required. It patches whichever `maestro` is first on PATH, so
    // put the one the app runs (maybe the managed install) first.
    info!("running maestro-ios-device setup");
    let out = tokio::process::Command::new(&dest)
        .arg("setup")
        .env("PATH", crate::tool_paths::path_with_maestro_first())
        .output()
        .await
        .map_err(|e| AppError::Other(format!("maestro-ios-device setup: {e}")))?;
    if !out.status.success() {
        // The Go bridge prints its failure reason to STDOUT (its `fatal` uses
        // fmt.Printf), so stderr alone is usually empty — surface both, keeping
        // the tail where the actual "❌ Setup failed: …" line lands.
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        let lines: Vec<&str> = stdout
            .lines()
            .chain(stderr.lines())
            .filter(|l| !l.trim().is_empty())
            .collect();
        let detail = lines[lines.len().saturating_sub(4)..].join(" | ");
        return Err(AppError::Other(format!(
            "maestro-ios-device setup failed: {detail}"
        )));
    }

    let dest_str = dest.to_string_lossy().to_string();
    crate::tool_paths::set_maestro_ios_device_path(&dest_str)?;
    info!(path = %dest_str, "maestro-ios-device installed");
    Ok(dest_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bridge_versions() {
        let banner = "maestro-ios-device v2.0.0\n  🚀 3.6x faster, real iOS device support";
        assert_eq!(parse_version(banner), Some((2, 0, 0)));
        assert_eq!(
            parse_version("maestro-ios-device v2.10.0-local"),
            Some((2, 10, 0))
        );
        assert_eq!(
            parse_version("maestro-ios-device v1.0.1-3-gabc123"),
            Some((1, 0, 1))
        );
        assert_eq!(parse_version("maestro-ios-device dev"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn v1_bridges_are_outdated() {
        assert!(parse_version("maestro-ios-device v1.0.1").unwrap() < REQUIRED_BRIDGE);
        assert!(parse_version("maestro-ios-device v2.0.0").unwrap() >= REQUIRED_BRIDGE);
        assert!(parse_version("maestro-ios-device v2.1.0").unwrap() >= REQUIRED_BRIDGE);
    }
}

/// Live: `MAESTRO_DECK_LIVE_BRIDGE=1 cargo test --lib bridge_update_end_to_end
/// -- --ignored`. Downloads the latest bridge release and patches the maestro
/// the app resolves, the way a physical-device connect does after an update.
#[cfg(test)]
mod live {
    #[tokio::test]
    #[ignore]
    async fn bridge_update_end_to_end() {
        if std::env::var_os("MAESTRO_DECK_LIVE_BRIDGE").is_none() {
            return;
        }
        let mut installed = false;
        super::ensure_current(|| installed = true).await.unwrap();
        eprintln!("reinstalled: {installed}");
        assert!(super::is_current().await, "bridge still outdated");
        let maestro = crate::tool_paths::maestro_bin();
        assert!(crate::runner::maestro_has_ios_device_patch(&maestro).await);
    }
}
