// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! `theme.json`: design-token values a theme plugin supplies. Pure data,
//! validated to a closed token list and strict value grammars, so nothing a
//! plugin writes can reach the DOM as free CSS.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::manifest::safe_relative;

const MAX_THEME_BYTES: u64 = 64 * 1024;

/// The tokens a theme may set, mirroring `src/styles/globals.css`.
pub const TOKENS: &[&str] = &[
    "background",
    "foreground",
    "card",
    "card-foreground",
    "popover",
    "popover-foreground",
    "surface",
    "muted",
    "muted-foreground",
    "border",
    "input",
    "primary",
    "primary-foreground",
    "secondary",
    "secondary-foreground",
    "accent",
    "accent-foreground",
    "destructive",
    "destructive-foreground",
    "ring",
    "brand",
    "brand-foreground",
    "success",
    "warning",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Theme {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub light: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dark: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radius: Option<String>,
}

/// One number: ascii digits with at most one `.`, nothing else (no sign,
/// exponent, `NaN` or `inf`, which `f64::from_str` would accept).
fn number_in(s: &str, max: f64) -> bool {
    !s.is_empty()
        && !s.starts_with('.')
        && !s.ends_with('.')
        && s.bytes().all(|c| c.is_ascii_digit() || c == b'.')
        && s.bytes().filter(|&c| c == b'.').count() <= 1
        && s.parse::<f64>().is_ok_and(|n| (0.0..=max).contains(&n))
}

/// `H S% L%` with single spaces, as in `globals.css`.
pub fn valid_hsl(v: &str) -> bool {
    let parts: Vec<&str> = v.split(' ').collect();
    let [h, s, l] = parts.as_slice() else {
        return false;
    };
    let pct = |p: &str| p.strip_suffix('%').is_some_and(|n| number_in(n, 100.0));
    number_in(h, 360.0) && pct(s) && pct(l)
}

/// `<n>rem` with 0 ≤ n ≤ 1.
pub fn valid_radius(v: &str) -> bool {
    v.strip_suffix("rem").is_some_and(|n| number_in(n, 1.0))
}

fn validate_variant(name: &str, v: &BTreeMap<String, String>) -> Result<(), String> {
    if v.is_empty() {
        return Err(format!("theme.json: \"{name}\" is empty"));
    }
    for (k, val) in v {
        if !TOKENS.contains(&k.as_str()) {
            return Err(format!("theme.json: unknown token \"{k}\" in \"{name}\""));
        }
        if !valid_hsl(val) {
            return Err(format!(
                "theme.json: {name}.{k} must be an HSL triplet like \"240 9% 7%\", got {val:?}"
            ));
        }
    }
    Ok(())
}

pub fn validate_theme(t: &Theme) -> Result<(), String> {
    if t.light.is_none() && t.dark.is_none() {
        return Err("theme.json needs a \"light\" or \"dark\" variant".into());
    }
    if let Some(v) = &t.light {
        validate_variant("light", v)?;
    }
    if let Some(v) = &t.dark {
        validate_variant("dark", v)?;
    }
    if let Some(r) = &t.radius {
        if !valid_radius(r) {
            return Err(format!(
                "theme.json: radius must be between 0rem and 1rem, got {r:?}"
            ));
        }
    }
    Ok(())
}

pub fn parse_theme(bytes: &[u8]) -> Result<Theme, String> {
    let t: Theme = serde_json::from_slice(bytes).map_err(|e| format!("theme.json invalid: {e}"))?;
    validate_theme(&t)?;
    Ok(t)
}

/// The theme file `rel` inside the plugin folder `dir`, validated.
pub fn load_theme(dir: &Path, rel: &str) -> Result<Theme, String> {
    if !safe_relative(rel) {
        return Err(format!("invalid theme path: {rel}"));
    }
    let path = dir.join(rel);
    let meta = fs::metadata(&path).map_err(|e| format!("theme file unreadable: {e}"))?;
    if !meta.is_file() || meta.len() > MAX_THEME_BYTES {
        return Err(format!(
            "theme file must be a file of at most 64 KiB: {rel}"
        ));
    }
    parse_theme(&fs::read(&path).map_err(|e| format!("theme file unreadable: {e}"))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hsl_values() {
        assert!(valid_hsl("240 9% 7%"));
        assert!(valid_hsl("360 100% 0%"));
        assert!(valid_hsl("17 96.5% 52%"));
        assert!(!valid_hsl("361 9% 7%"));
        assert!(!valid_hsl("240 101% 7%"));
        assert!(!valid_hsl("240 9 7%"));
        assert!(!valid_hsl("240  9% 7%"));
        assert!(!valid_hsl("1e2 50% 50%"));
        assert!(!valid_hsl("NaN 1% 1%"));
        assert!(!valid_hsl("inf 1% 1%"));
        assert!(!valid_hsl("-1 1% 1%"));
        assert!(!valid_hsl("1..2 1% 1%"));
        assert!(!valid_hsl("red; background: url(https://x)"));
        assert!(!valid_hsl(""));
    }

    #[test]
    fn radius_values() {
        assert!(valid_radius("0rem"));
        assert!(valid_radius("0.5rem"));
        assert!(valid_radius("1rem"));
        assert!(!valid_radius("1.5rem"));
        assert!(!valid_radius("4px"));
        assert!(!valid_radius("rem"));
        assert!(!valid_radius("0.5 rem"));
    }

    #[test]
    fn parses_a_full_theme() {
        let t = parse_theme(
            br#"{"light":{"background":"220 23% 95%","brand":"266 85% 58%"},
                 "dark":{"background":"240 21% 15%"},"radius":"0.5rem"}"#,
        )
        .unwrap();
        assert_eq!(t.light.unwrap()["brand"], "266 85% 58%");
        assert_eq!(t.radius.as_deref(), Some("0.5rem"));
    }

    #[test]
    fn single_variant_is_fine() {
        assert!(parse_theme(br#"{"dark":{"brand":"267 84% 81%"}}"#).is_ok());
    }

    #[test]
    fn rejects_bad_themes() {
        for bad in [
            &br#"{}"#[..],
            br#"{"radius":"0.5rem"}"#,
            br#"{"light":{}}"#,
            br#"{"light":{"--x":"1 1% 1%"}}"#,
            br#"{"light":{"radius":"0.5rem"}}"#,
            br#"{"light":{"brand":"red"}}"#,
            br#"{"light":{"brand":"1 1% 1%"},"radius":"2rem"}"#,
            br#"{"light":{"brand":"1 1% 1%"},"css":"body{}"}"#,
            br#"not json"#,
        ] {
            assert!(
                parse_theme(bad).is_err(),
                "{}",
                String::from_utf8_lossy(bad)
            );
        }
    }

    #[test]
    fn load_theme_checks_path_and_size() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("theme.json"),
            br#"{"dark":{"brand":"1 1% 1%"}}"#,
        )
        .unwrap();
        assert!(load_theme(dir.path(), "theme.json").is_ok());
        assert!(load_theme(dir.path(), "../theme.json").is_err());
        assert!(load_theme(dir.path(), "missing.json").is_err());
        let big = format!(
            r#"{{"dark":{{"brand":"1 1% 1%"}},"radius":"0.5rem"{}}}"#,
            " ".repeat(70 * 1024)
        );
        fs::write(dir.path().join("big.json"), big).unwrap();
        assert!(load_theme(dir.path(), "big.json").is_err());
    }
}
