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
}
