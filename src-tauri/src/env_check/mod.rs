// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Environment prerequisite checks for the onboarding setup popup.
//! Probes the tools the app shells out to (maestro, java, adb, Xcode)
//! and drives the one-click installers.

/// Parse the Java major version out of `java -version` output (which goes to
/// stderr). Handles both schemes:
///   modern: `openjdk version "21.0.2" 2024-01-16` → 21
///   modern: `java version "17" 2021-09-14` → 17
///   legacy: `java version "1.8.0_392"` → 8
pub(crate) fn parse_java_major(out: &str) -> Option<u32> {
    let quoted = out.split('"').nth(1)?;
    let mut parts = quoted.split('.');
    let first: u32 = parts.next()?.parse().ok()?;
    if first == 1 {
        // Legacy 1.x scheme: the major is the second component.
        parts.next()?.parse().ok()
    } else {
        Some(first)
    }
}

use serde::Serialize;

pub(crate) const REQUIRED_MAESTRO: &str = "2.5.1";
pub(crate) const MIN_JAVA_MAJOR: u32 = 17;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvCheck {
    pub id: String,
    /// "ok" | "missing" | "wrong-version" | "error"
    pub status: String,
    pub version: Option<String>,
    pub detail: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EnvStatus {
    pub checks: Vec<EnvCheck>,
    pub minimal_ok: bool,
}

/// Map a maestro `--version` probe result to a check. `None` = binary missing
/// or probe failed (detail carries the reason).
pub(crate) fn maestro_check(version: Option<String>, detail: Option<String>) -> EnvCheck {
    match version {
        Some(v) if v == REQUIRED_MAESTRO => EnvCheck {
            id: "maestro".into(),
            status: "ok".into(),
            version: Some(v),
            detail: None,
        },
        Some(v) => EnvCheck {
            id: "maestro".into(),
            status: "wrong-version".into(),
            version: Some(v),
            detail: Some(format!("need {REQUIRED_MAESTRO}")),
        },
        None => EnvCheck {
            id: "maestro".into(),
            status: "missing".into(),
            version: None,
            detail,
        },
    }
}

pub(crate) fn java_check(major: Option<u32>, raw: Option<String>) -> EnvCheck {
    match major {
        Some(m) if m >= MIN_JAVA_MAJOR => EnvCheck {
            id: "java".into(),
            status: "ok".into(),
            version: Some(m.to_string()),
            detail: None,
        },
        Some(m) => EnvCheck {
            id: "java".into(),
            status: "wrong-version".into(),
            version: Some(m.to_string()),
            detail: Some(format!("need {MIN_JAVA_MAJOR}+")),
        },
        None => EnvCheck {
            id: "java".into(),
            status: "missing".into(),
            version: None,
            detail: raw,
        },
    }
}

use std::time::Duration;

use crate::error::AppResult;

const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// Run `bin args…`, return combined stdout+stderr on success-exit, or an
/// Err(detail) describing spawn failure / non-zero exit / timeout.
async fn probe(bin: &str, args: &[&str]) -> Result<String, String> {
    let fut = tokio::process::Command::new(bin).args(args).output();
    match tokio::time::timeout(PROBE_TIMEOUT, fut).await {
        Err(_) => Err(format!("{bin} timed out after 10s")),
        Ok(Err(e)) => Err(format!("{bin}: {e}")),
        Ok(Ok(out)) => {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            if out.status.success() {
                Ok(text)
            } else {
                Err(text.lines().next().unwrap_or("non-zero exit").to_string())
            }
        }
    }
}

async fn probe_maestro() -> EnvCheck {
    let bin = crate::tool_paths::maestro_bin();
    match probe(&bin, &["--version"]).await {
        Ok(text) => maestro_check(crate::ipc::commands::parse_maestro_version(&text), None),
        Err(detail) => maestro_check(None, Some(detail)),
    }
}

async fn probe_java() -> EnvCheck {
    match probe("java", &["-version"]).await {
        Ok(text) => java_check(
            parse_java_major(&text),
            Some(text.lines().next().unwrap_or("").to_string()),
        ),
        Err(detail) => java_check(None, Some(detail)),
    }
}

async fn probe_adb() -> EnvCheck {
    let bin = crate::tool_paths::adb_bin();
    match probe(&bin, &["version"]).await {
        Ok(text) => EnvCheck {
            id: "adb".into(),
            status: "ok".into(),
            // First line: "Android Debug Bridge version 1.0.41"
            version: text
                .lines()
                .next()
                .and_then(|l| l.rsplit(' ').next())
                .map(String::from),
            detail: None,
        },
        Err(detail) => EnvCheck {
            id: "adb".into(),
            status: "missing".into(),
            version: None,
            detail: Some(detail),
        },
    }
}

async fn probe_xcode() -> EnvCheck {
    // Full Xcode resolves inside an .app bundle; bare CommandLineTools don't count.
    match probe("xcode-select", &["-p"]).await {
        Ok(text) if text.contains(".app/Contents/Developer") => EnvCheck {
            id: "xcode".into(),
            status: "ok".into(),
            version: None,
            detail: None,
        },
        Ok(text) => EnvCheck {
            id: "xcode".into(),
            status: "missing".into(),
            version: None,
            detail: Some(format!("found {} — full Xcode required", text.trim())),
        },
        Err(detail) => EnvCheck {
            id: "xcode".into(),
            status: "missing".into(),
            version: None,
            detail: Some(detail),
        },
    }
}

#[tauri::command]
pub async fn environment_status() -> AppResult<EnvStatus> {
    let (maestro, java, adb, xcode) =
        tokio::join!(probe_maestro(), probe_java(), probe_adb(), probe_xcode());
    let minimal_ok = maestro.status == "ok" && java.status == "ok";
    Ok(EnvStatus {
        checks: vec![maestro, java, adb, xcode],
        minimal_ok,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_modern_openjdk() {
        let out =
            "openjdk version \"21.0.2\" 2024-01-16\nOpenJDK Runtime Environment Temurin-21.0.2+13";
        assert_eq!(parse_java_major(out), Some(21));
    }

    #[test]
    fn parses_modern_no_minor() {
        assert_eq!(parse_java_major("java version \"17\" 2021-09-14"), Some(17));
    }

    #[test]
    fn parses_legacy_1_8() {
        assert_eq!(parse_java_major("java version \"1.8.0_392\""), Some(8));
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse_java_major("command not found: java"), None);
        assert_eq!(parse_java_major(""), None);
    }

    #[test]
    fn maestro_251_is_ok_other_versions_are_wrong_version() {
        assert_eq!(maestro_check(Some("2.5.1".into()), None).status, "ok");
        let c = maestro_check(Some("2.6.0".into()), None);
        assert_eq!(c.status, "wrong-version");
        assert_eq!(c.detail.as_deref(), Some("need 2.5.1"));
        assert_eq!(maestro_check(None, None).status, "missing");
    }

    #[test]
    fn java_17_plus_is_ok_older_is_wrong_version() {
        assert_eq!(java_check(Some(21), None).status, "ok");
        assert_eq!(java_check(Some(8), None).status, "wrong-version");
        assert_eq!(java_check(None, None).status, "missing");
    }
}
