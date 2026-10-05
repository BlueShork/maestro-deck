// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! `manifest.json`: what a plugin is and what it may touch.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub min_app_version: String,
    pub entry: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub panel: Option<PanelSpec>,
    #[serde(default)]
    pub permissions: Permissions,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PanelSpec {
    pub title: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Permissions {
    /// Origins `http.fetch` may reach.
    pub http: Vec<String>,
    /// Extra origins `ui.openExternal` may open (the `http` ones are implied).
    pub open: Vec<String>,
    pub secrets: bool,
}

pub fn valid_id(id: &str) -> bool {
    let b = id.as_bytes();
    !b.is_empty()
        && b.len() <= 32
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

pub fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 64
        && key
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
}

/// `major.minor.patch`, ignoring any `-pre` / `+build` suffix.
pub fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let core = v.split(['-', '+']).next()?;
    let mut it = core.split('.');
    let out = (
        it.next()?.parse().ok()?,
        it.next()?.parse().ok()?,
        it.next()?.parse().ok()?,
    );
    if it.next().is_some() {
        return None;
    }
    Some(out)
}

pub fn version_at_least(have: &str, need: &str) -> bool {
    matches!((parse_version(have), parse_version(need)), (Some(h), Some(n)) if h >= n)
}

/// A path inside the plugin folder: relative, `/`-separated, no `..`.
pub fn safe_relative(p: &str) -> bool {
    !p.is_empty()
        && !p.starts_with('/')
        && !p.contains('\\')
        && !p.contains(':')
        && p.split('/').all(|seg| !seg.is_empty() && seg != "..")
}

fn valid_pattern(p: &str) -> bool {
    let Some(host) = p.strip_prefix("https://") else {
        return false;
    };
    let host = host.strip_prefix("*.").unwrap_or(host);
    host.contains('.')
        && !host.starts_with('.')
        && !host.ends_with('.')
        && host
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.')
}

pub fn validate(m: &Manifest) -> Result<(), String> {
    if !valid_id(&m.id) {
        return Err(format!("invalid plugin id: {:?}", m.id));
    }
    if m.name.trim().is_empty() {
        return Err("manifest name is empty".into());
    }
    if parse_version(&m.version).is_none() {
        return Err(format!("invalid version: {}", m.version));
    }
    if parse_version(&m.min_app_version).is_none() {
        return Err(format!("invalid minAppVersion: {}", m.min_app_version));
    }
    if !safe_relative(&m.entry) {
        return Err(format!("invalid entry path: {}", m.entry));
    }
    if let Some(icon) = &m.icon {
        if !safe_relative(icon) {
            return Err(format!("invalid icon path: {icon}"));
        }
    }
    for p in m.permissions.http.iter().chain(&m.permissions.open) {
        if !valid_pattern(p) {
            return Err(format!("invalid origin pattern: {p}"));
        }
    }
    Ok(())
}

/// Whether `url` is https on the default port, without credentials, and its
/// host matches one of `patterns` (`https://host` or `https://*.domain`).
pub fn origin_allowed(patterns: &[String], url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else {
        return false;
    };
    if u.scheme() != "https"
        || u.port().is_some()
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return false;
    }
    let Some(host) = u.host_str() else {
        return false;
    };
    patterns.iter().any(|p| {
        let Some(pat) = p.strip_prefix("https://") else {
            return false;
        };
        match pat.strip_prefix("*.") {
            Some(suffix) => {
                host.len() > suffix.len() + 1
                    && host.ends_with(suffix)
                    && host.as_bytes()[host.len() - suffix.len() - 1] == b'.'
            }
            None => host == pat,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pats(p: &[&str]) -> Vec<String> {
        p.iter().map(|s| s.to_string()).collect()
    }

    fn sample() -> Manifest {
        serde_json::from_str(
            r#"{"id":"jira","name":"Jira","version":"1.0.0","minAppVersion":"1.1.0",
                "entry":"index.html","icon":"icon.svg","panel":{"title":"Jira"},
                "permissions":{"http":["https://*.atlassian.net"],"open":["https://id.atlassian.com"],"secrets":true}}"#,
        )
        .unwrap()
    }

    #[test]
    fn ids() {
        assert!(valid_id("jira"));
        assert!(valid_id("a1-b"));
        assert!(!valid_id(""));
        assert!(!valid_id("-jira"));
        assert!(!valid_id("Jira"));
        assert!(!valid_id("ji/ra"));
        assert!(!valid_id(&"a".repeat(33)));
    }

    #[test]
    fn keys() {
        assert!(valid_key("credentials"));
        assert!(valid_key("last_project-2"));
        assert!(!valid_key(""));
        assert!(!valid_key("a:b"));
        assert!(!valid_key(&"k".repeat(65)));
    }

    #[test]
    fn versions() {
        assert_eq!(parse_version("1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("1.2.3-beta.1"), Some((1, 2, 3)));
        assert_eq!(parse_version("1.2"), None);
        assert!(version_at_least("1.1.0", "1.1.0"));
        assert!(version_at_least("1.10.0", "1.9.9"));
        assert!(!version_at_least("1.1.0", "1.2.0"));
        assert!(!version_at_least("garbage", "1.0.0"));
    }

    #[test]
    fn relative_paths() {
        assert!(safe_relative("index.html"));
        assert!(safe_relative("assets/app.js"));
        assert!(!safe_relative(""));
        assert!(!safe_relative("/etc/passwd"));
        assert!(!safe_relative("../x"));
        assert!(!safe_relative("a/../../x"));
        assert!(!safe_relative("a\\b"));
        assert!(!safe_relative("C:/x"));
        assert!(!safe_relative("a//b"));
    }

    #[test]
    fn validates_sample_and_rejects_bad_fields() {
        assert!(validate(&sample()).is_ok());
        let mut m = sample();
        m.entry = "../index.html".into();
        assert!(validate(&m).is_err());
        let mut m = sample();
        m.permissions.http = pats(&["http://*.atlassian.net"]);
        assert!(validate(&m).is_err());
        let mut m = sample();
        m.permissions.http = pats(&["https://*.atlassian.net/path"]);
        assert!(validate(&m).is_err());
        let mut m = sample();
        m.permissions.open = pats(&["https://*"]);
        assert!(validate(&m).is_err());
        let mut m = sample();
        m.min_app_version = "soon".into();
        assert!(validate(&m).is_err());
    }

    #[test]
    fn origins() {
        let p = pats(&["https://*.atlassian.net", "https://id.atlassian.com"]);
        assert!(origin_allowed(
            &p,
            "https://acme.atlassian.net/rest/api/3/myself"
        ));
        assert!(origin_allowed(&p, "https://a.b.atlassian.net/"));
        assert!(origin_allowed(&p, "https://id.atlassian.com/manage"));
        assert!(!origin_allowed(&p, "https://atlassian.net/"));
        assert!(!origin_allowed(&p, "https://evilatlassian.net/"));
        assert!(!origin_allowed(&p, "https://acme.atlassian.net.evil.com/"));
        assert!(!origin_allowed(&p, "http://acme.atlassian.net/"));
        assert!(!origin_allowed(&p, "https://acme.atlassian.net:8443/"));
        assert!(!origin_allowed(&p, "https://user:pw@acme.atlassian.net/"));
        assert!(!origin_allowed(&p, "not a url"));
        assert!(!origin_allowed(&[], "https://acme.atlassian.net/"));
    }
}
