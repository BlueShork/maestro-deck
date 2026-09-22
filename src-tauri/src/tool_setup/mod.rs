// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! First-launch toolchain setup.
//!
//! The app downloads pinned copies of Java, Maestro and `adb` into its own data
//! directory and runs them from there. No package manager, no PATH surgery,
//! nothing installed system-wide, and the same code on macOS and Windows.
//!
//! Homebrew and winget were rejected for this: either can be absent, and both
//! can demand an administrator password in the middle of a first launch — the
//! exact interruption this feature exists to remove.
//!
//! See docs/superpowers/specs/2026-09-22-first-launch-tool-setup-design.md.

pub mod install;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::env_check::REQUIRED_MAESTRO;

/// The tools the app installs for itself. Xcode is deliberately absent: several
/// GB, an Apple licence, and no scriptable install — and it is only needed for
/// *local* iOS runs, which is not the path a first flow takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ManagedTool {
    Java,
    Maestro,
    Adb,
}

impl ManagedTool {
    pub const ALL: [ManagedTool; 3] = [ManagedTool::Java, ManagedTool::Maestro, ManagedTool::Adb];

    pub fn id(self) -> &'static str {
        match self {
            ManagedTool::Java => "java",
            ManagedTool::Maestro => "maestro",
            ManagedTool::Adb => "adb",
        }
    }

    /// Human name for progress lines. The user did not ask for "temurin".
    pub fn label(self) -> &'static str {
        match self {
            ManagedTool::Java => "Java",
            ManagedTool::Maestro => "Maestro",
            ManagedTool::Adb => "Android platform tools",
        }
    }

    /// The executable to look for once the archive is extracted. Searched for
    /// by name rather than assumed at a fixed depth: each archive nests its
    /// payload differently (Temurin under a versioned directory, and on macOS
    /// under `Contents/Home` as well), and a layout change would otherwise
    /// leave us pointing at nothing.
    pub fn binary_name(self, os: Os) -> &'static str {
        match (self, os) {
            (ManagedTool::Java, Os::Windows) => "java.exe",
            (ManagedTool::Java, _) => "java",
            // The shipped launcher is a shell script; Windows gets the .bat.
            (ManagedTool::Maestro, Os::Windows) => "maestro.bat",
            (ManagedTool::Maestro, _) => "maestro",
            (ManagedTool::Adb, Os::Windows) => "adb.exe",
            (ManagedTool::Adb, _) => "adb",
        }
    }

    pub fn archive_kind(self, os: Os) -> ArchiveKind {
        match (self, os) {
            // Adoptium ships a tarball for macOS and a zip for Windows.
            (ManagedTool::Java, Os::Mac) => ArchiveKind::TarGz,
            _ => ArchiveKind::Zip,
        }
    }

    /// Where the archive comes from. Every URL here was verified live against
    /// the real hosts; see the spec's table.
    pub fn archive_url(self, os: Os, arch: Arch) -> String {
        match self {
            // The API resolves "latest GA" for the pinned major and redirects
            // to the concrete asset, so we never hardcode a patch version.
            ManagedTool::Java => format!(
                "https://api.adoptium.net/v3/binary/latest/{JAVA_MAJOR}/ga/{}/{}/jdk/hotspot/normal/eclipse",
                os.adoptium(),
                arch.adoptium(),
            ),
            // Pinned to the exact version env_check demands, so the probe that
            // rejects anything else keeps its meaning.
            ManagedTool::Maestro => format!(
                "https://github.com/mobile-dev-inc/maestro/releases/download/cli-{REQUIRED_MAESTRO}/maestro.zip"
            ),
            ManagedTool::Adb => format!(
                "https://dl.google.com/android/repository/platform-tools-latest-{}.zip",
                os.google(),
            ),
        }
    }
}

/// Matches MIN_JAVA_MAJOR's intent: 17 is the floor the probe accepts, 21 is
/// the LTS `install_tool` already installed before this module existed.
const JAVA_MAJOR: u32 = 21;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Mac,
    Windows,
}

impl Os {
    pub fn current() -> Option<Os> {
        match std::env::consts::OS {
            "macos" => Some(Os::Mac),
            "windows" => Some(Os::Windows),
            _ => None,
        }
    }

    fn adoptium(self) -> &'static str {
        match self {
            Os::Mac => "mac",
            Os::Windows => "windows",
        }
    }

    fn google(self) -> &'static str {
        match self {
            Os::Mac => "darwin",
            Os::Windows => "windows",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Arch {
    X64,
    Aarch64,
}

impl Arch {
    pub fn current() -> Option<Arch> {
        match std::env::consts::ARCH {
            "x86_64" => Some(Arch::X64),
            "aarch64" => Some(Arch::Aarch64),
            _ => None,
        }
    }

    fn adoptium(self) -> &'static str {
        match self {
            Arch::X64 => "x64",
            Arch::Aarch64 => "aarch64",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveKind {
    Zip,
    TarGz,
}

/// Absolute paths to the tools this app installed, keyed by tool id.
///
/// Recorded rather than recomputed: finding the binary means walking an
/// extracted tree, and doing that on every resolution would be wasteful. The
/// path is re-validated on read, so a manifest pointing at a deleted file is
/// treated as "not installed" rather than handed out.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ToolManifest {
    #[serde(default)]
    pub java: Option<String>,
    #[serde(default)]
    pub maestro: Option<String>,
    #[serde(default)]
    pub adb: Option<String>,
}

impl ToolManifest {
    pub fn get(&self, tool: ManagedTool) -> Option<&str> {
        let raw = match tool {
            ManagedTool::Java => self.java.as_deref(),
            ManagedTool::Maestro => self.maestro.as_deref(),
            ManagedTool::Adb => self.adb.as_deref(),
        }?;
        // A recorded path whose file has since gone is worse than no path: the
        // caller would hand it to a process spawn and get a confusing ENOENT.
        Path::new(raw).is_file().then_some(raw)
    }

    pub fn set(&mut self, tool: ManagedTool, path: &Path) {
        let value = Some(path.to_string_lossy().into_owned());
        match tool {
            ManagedTool::Java => self.java = value,
            ManagedTool::Maestro => self.maestro = value,
            ManagedTool::Adb => self.adb = value,
        }
    }
}

/// Depth-limited search for `name` under `root`, preferring a `bin/` parent.
///
/// The preference matters for the JDK, which ships several executables of the
/// same name in different roles; `bin/java` is the launcher we want.
pub fn find_binary(root: &Path, name: &str, max_depth: usize) -> Option<PathBuf> {
    let mut found: Option<PathBuf> = None;
    let mut stack = vec![(root.to_path_buf(), 0usize)];

    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if depth < max_depth {
                    stack.push((path, depth + 1));
                }
            } else if path.file_name().is_some_and(|f| f == name) {
                let in_bin = path.parent().is_some_and(|p| p.ends_with("bin"));
                if in_bin {
                    return Some(path);
                }
                found.get_or_insert(path);
            }
        }
    }

    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn java_url_carries_os_and_arch() {
        let url = ManagedTool::Java.archive_url(Os::Mac, Arch::Aarch64);
        assert!(url.contains("/21/ga/mac/aarch64/jdk/"), "{url}");

        let url = ManagedTool::Java.archive_url(Os::Windows, Arch::X64);
        assert!(url.contains("/21/ga/windows/x64/jdk/"), "{url}");
    }

    #[test]
    fn maestro_url_pins_the_version_the_probe_demands() {
        // env_check rejects any other version, so a drifting download would
        // install something the app then refuses to use.
        let url = ManagedTool::Maestro.archive_url(Os::Mac, Arch::Aarch64);
        assert!(
            url.contains(&format!("cli-{REQUIRED_MAESTRO}/maestro.zip")),
            "{url}"
        );
    }

    #[test]
    fn adb_url_uses_googles_platform_names() {
        assert!(ManagedTool::Adb
            .archive_url(Os::Mac, Arch::Aarch64)
            .ends_with("platform-tools-latest-darwin.zip"));
        assert!(ManagedTool::Adb
            .archive_url(Os::Windows, Arch::X64)
            .ends_with("platform-tools-latest-windows.zip"));
    }

    #[test]
    fn windows_binaries_carry_their_extension() {
        assert_eq!(ManagedTool::Java.binary_name(Os::Windows), "java.exe");
        assert_eq!(ManagedTool::Java.binary_name(Os::Mac), "java");
        assert_eq!(ManagedTool::Maestro.binary_name(Os::Windows), "maestro.bat");
        assert_eq!(ManagedTool::Adb.binary_name(Os::Windows), "adb.exe");
    }

    #[test]
    fn only_the_mac_jdk_is_a_tarball() {
        assert_eq!(ManagedTool::Java.archive_kind(Os::Mac), ArchiveKind::TarGz);
        assert_eq!(
            ManagedTool::Java.archive_kind(Os::Windows),
            ArchiveKind::Zip
        );
        assert_eq!(ManagedTool::Maestro.archive_kind(Os::Mac), ArchiveKind::Zip);
    }

    #[test]
    fn manifest_ignores_a_path_whose_file_is_gone() {
        let mut m = ToolManifest::default();
        m.set(ManagedTool::Maestro, Path::new("/nonexistent/maestro"));
        // Handing this out would turn a missing install into a confusing
        // spawn error at the call site.
        assert_eq!(m.get(ManagedTool::Maestro), None);
    }

    #[test]
    fn manifest_returns_a_path_that_exists() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("maestro");
        std::fs::write(&bin, b"#!/bin/sh\n").unwrap();

        let mut m = ToolManifest::default();
        m.set(ManagedTool::Maestro, &bin);
        assert_eq!(m.get(ManagedTool::Maestro), Some(bin.to_str().unwrap()));
    }

    #[test]
    fn find_binary_prefers_the_launcher_in_bin() {
        let dir = tempfile::tempdir().unwrap();
        let stray = dir.path().join("lib");
        let real = dir.path().join("jdk/Contents/Home/bin");
        std::fs::create_dir_all(&stray).unwrap();
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(stray.join("java"), b"decoy").unwrap();
        std::fs::write(real.join("java"), b"launcher").unwrap();

        let found = find_binary(dir.path(), "java", 8).unwrap();
        assert!(found.ends_with("bin/java"), "{}", found.display());
    }

    #[test]
    fn find_binary_reports_nothing_when_absent() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(find_binary(dir.path(), "maestro", 4), None);
    }
}
