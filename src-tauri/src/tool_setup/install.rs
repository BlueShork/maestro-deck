// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Downloading and unpacking the managed toolchain.
//!
//! Kept deliberately thin: the decisions (which URL, which binary, is it ready)
//! live in the parent module where they are unit-tested. What is here is I/O,
//! verified by running it.

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use futures::StreamExt;
use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tracing::{info, warn};

use super::{find_binary, Arch, ArchiveKind, ManagedTool, Os, ToolManifest};
use crate::error::{AppError, AppResult};

const EVT_PROGRESS: &str = "setup:progress";
const EVT_DONE: &str = "setup:done";

/// How deep to look for a binary in an extracted tree. Temurin on macOS nests
/// it at `jdk-<version>/Contents/Home/bin/java`, which is five.
const SEARCH_DEPTH: usize = 8;

#[derive(Serialize, Clone)]
struct Progress {
    tool: &'static str,
    label: &'static str,
    phase: &'static str,
    /// 0-100 while downloading; absent while extracting, whose duration we
    /// cannot honestly report.
    percent: Option<u8>,
}

#[derive(Serialize, Clone)]
struct Done {
    tool: &'static str,
    label: &'static str,
    ok: bool,
    error: Option<String>,
}

/// The manifest as last read or written. Held in memory so `tool_paths` can
/// consult it on every resolution without touching the disk.
static MANIFEST: Lazy<RwLock<ToolManifest>> = Lazy::new(|| RwLock::new(load_manifest()));

/// Mirrors `tool_paths::config_file` so both live under the same per-user
/// directory. Kept separate rather than shared: these are our own downloads,
/// not the user's settings, and deleting one should never mean losing the other.
fn tools_root() -> Option<PathBuf> {
    let dir = if cfg!(target_os = "macos") {
        dirs_home()?.join("Library/Application Support/com.maestro-deck")
    } else if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)?
            .join("maestro-deck")
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| dirs_home().unwrap_or_default().join(".local/share"))
            .join("maestro-deck")
    };
    Some(dir.join("tools"))
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn manifest_file() -> Option<PathBuf> {
    Some(tools_root()?.join("manifest.json"))
}

fn load_manifest() -> ToolManifest {
    manifest_file()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_manifest(manifest: &ToolManifest) -> AppResult<()> {
    let path = manifest_file()
        .ok_or_else(|| AppError::Other("no data directory for this platform".into()))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(
        path,
        serde_json::to_vec_pretty(manifest).unwrap_or_default(),
    )?;
    Ok(())
}

/// Absolute path to a tool this app installed, or `None` when it has not been
/// installed (or its file has since been removed).
pub fn managed_path(tool: ManagedTool) -> Option<String> {
    MANIFEST.read().ok()?.get(tool).map(str::to_owned)
}

/// Streams `url` into `dest`, reporting progress as whole percents.
///
/// Writes to a sibling `.part` and renames on success, so an interrupted
/// download never leaves a truncated archive that the next launch would try to
/// unpack.
async fn download(app: &AppHandle, tool: ManagedTool, url: &str, dest: &Path) -> AppResult<()> {
    let part = dest.with_extension("part");
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let res = reqwest::get(url)
        .await
        .map_err(|e| AppError::Other(format!("downloading {}: {e}", tool.label())))?;
    if !res.status().is_success() {
        return Err(AppError::Other(format!(
            "downloading {}: HTTP {}",
            tool.label(),
            res.status()
        )));
    }

    let total = res.content_length();
    let mut file = tokio::fs::File::create(&part).await?;
    let mut stream = res.bytes_stream();
    let mut written: u64 = 0;
    let mut last_percent = u8::MAX;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Other(format!("download interrupted: {e}")))?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await?;
        written += chunk.len() as u64;

        if let Some(total) = total.filter(|t| *t > 0) {
            let percent = ((written * 100) / total).min(100) as u8;
            // Emit on change only: a 200 MB JDK would otherwise flood the
            // webview with thousands of identical events.
            if percent != last_percent {
                last_percent = percent;
                emit_progress(app, tool, "download", Some(percent));
            }
        }
    }

    tokio::io::AsyncWriteExt::flush(&mut file).await?;
    drop(file);
    std::fs::rename(&part, dest)?;
    Ok(())
}

fn extract(archive: &Path, kind: ArchiveKind, dest: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dest)?;
    match kind {
        ArchiveKind::Zip => {
            let file = std::fs::File::open(archive)?;
            let mut zip = zip::ZipArchive::new(file)
                .map_err(|e| AppError::Other(format!("archive unreadable: {e}")))?;
            zip.extract(dest)
                .map_err(|e| AppError::Other(format!("extracting: {e}")))?;
        }
        ArchiveKind::TarGz => {
            let file = std::fs::File::open(archive)?;
            let gz = flate2::read::GzDecoder::new(file);
            tar::Archive::new(gz)
                .unpack(dest)
                .map_err(|e| AppError::Other(format!("extracting: {e}")))?;
        }
    }
    Ok(())
}

/// Zip does not always carry the executable bit, and a JDK extracted without it
/// fails with a bare "permission denied" the first time a flow runs.
#[cfg(unix)]
fn make_executable(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)?.permissions();
    perms.set_mode(perms.mode() | 0o755);
    std::fs::set_permissions(path, perms)?;
    Ok(())
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> AppResult<()> {
    Ok(())
}

fn emit_progress(app: &AppHandle, tool: ManagedTool, phase: &'static str, percent: Option<u8>) {
    let _ = app.emit(
        EVT_PROGRESS,
        Progress {
            tool: tool.id(),
            label: tool.label(),
            phase,
            percent,
        },
    );
}

/// Downloads, unpacks and records one tool. Idempotent: a tool whose recorded
/// binary is still on disk is skipped without touching the network.
pub async fn install(app: &AppHandle, tool: ManagedTool) -> AppResult<PathBuf> {
    if let Some(existing) = managed_path(tool) {
        return Ok(PathBuf::from(existing));
    }

    let os = Os::current()
        .ok_or_else(|| AppError::Other("no managed toolchain for this platform".into()))?;
    let arch =
        Arch::current().ok_or_else(|| AppError::Other("unsupported CPU architecture".into()))?;
    let root = tools_root().ok_or_else(|| AppError::Other("no data directory".into()))?;

    let url = tool.archive_url(os, arch);
    let kind = tool.archive_kind(os);
    let archive = root.join(format!(
        "{}.{}",
        tool.id(),
        match kind {
            ArchiveKind::Zip => "zip",
            ArchiveKind::TarGz => "tar.gz",
        }
    ));
    let dest = root.join(tool.id());

    info!(tool = tool.id(), %url, "installing managed tool");
    emit_progress(app, tool, "download", Some(0));
    download(app, tool, &url, &archive).await?;

    emit_progress(app, tool, "extract", None);
    // Start from a clean directory: a half-extracted tree from a previous
    // attempt would otherwise be searched and could yield a broken binary.
    let _ = std::fs::remove_dir_all(&dest);
    extract(&archive, kind, &dest)?;
    let _ = std::fs::remove_file(&archive);

    let binary = find_binary(&dest, tool.binary_name(os), SEARCH_DEPTH).ok_or_else(|| {
        AppError::Other(format!(
            "{} was downloaded but its executable was not found in the archive",
            tool.label()
        ))
    })?;
    make_executable(&binary)?;

    {
        let mut manifest = MANIFEST
            .write()
            .map_err(|_| AppError::Other("manifest lock poisoned".into()))?;
        manifest.set(tool, &binary);
        save_manifest(&manifest)?;
    }
    crate::tool_paths::invalidate_cache();
    if tool == ManagedTool::Java {
        apply_managed_java_env();
    }

    info!(tool = tool.id(), path = %binary.display(), "managed tool ready");
    Ok(binary)
}

/// Installs every tool that is missing, one at a time.
///
/// One failure does not stop the others: a machine that cannot reach GitHub may
/// still get its JDK, and only the tool that failed holds Run back.
#[tauri::command]
pub async fn setup_tools(app: AppHandle) -> AppResult<()> {
    for tool in ManagedTool::ALL {
        let result = install(&app, tool).await;
        let done = match &result {
            Ok(_) => Done {
                tool: tool.id(),
                label: tool.label(),
                ok: true,
                error: None,
            },
            Err(e) => {
                warn!(tool = tool.id(), error = %e, "managed tool install failed");
                Done {
                    tool: tool.id(),
                    label: tool.label(),
                    ok: false,
                    error: Some(e.to_string()),
                }
            }
        };
        let _ = app.emit(EVT_DONE, done);
    }
    Ok(())
}

/// Points this process (and therefore every tool it spawns) at the managed JDK.
///
/// Maestro is a JVM application: its launcher looks for `JAVA_HOME`, then a
/// `java` on PATH. Installing a JDK into our own directory and stopping there
/// would leave maestro exactly as broken as before on a machine with no system
/// Java — the whole point of the feature.
///
/// Only called when a managed JDK exists, which only happens when the probe
/// found the machine's own Java missing or too old, so overriding is right.
pub fn apply_managed_java_env() {
    let Some(java) = managed_path(ManagedTool::Java) else {
        return;
    };
    // <home>/bin/java → <home>
    let Some(home) = Path::new(&java).parent().and_then(|bin| bin.parent()) else {
        return;
    };

    std::env::set_var("JAVA_HOME", home);
    let bin = home.join("bin");
    let path = std::env::var_os("PATH").unwrap_or_default();
    let mut dirs = vec![bin];
    dirs.extend(std::env::split_paths(&path));
    if let Ok(joined) = std::env::join_paths(dirs) {
        std::env::set_var("PATH", joined);
    }
    info!(java_home = %home.display(), "using the managed JDK");
}

/// What the app has installed for itself, for the setup UI.
#[tauri::command]
pub fn managed_tools() -> ToolManifest {
    MANIFEST.read().map(|m| m.clone()).unwrap_or_default()
}
