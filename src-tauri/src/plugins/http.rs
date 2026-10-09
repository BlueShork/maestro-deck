// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! `http.fetch` for plugins: Rust makes the request so CORS never applies,
//! and only to origins the plugin's manifest declares.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::manifest::Allow;

const RESPONSE_CAP: usize = 5 * 1024 * 1024;
const METHODS: [&str; 5] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

#[derive(Debug, Deserialize)]
pub struct HttpRequest {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

pub fn header_blocked(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "host"
            | "content-length"
            | "cookie"
            | "connection"
            | "transfer-encoding"
            | "origin"
            | "referer"
    )
}

pub fn check_request(allow: &Allow, req: &HttpRequest) -> Result<reqwest::Method, String> {
    if !allow.allows(&req.url) {
        return Err(format!(
            "forbidden: {} is not allowed by this plugin's permissions",
            req.url
        ));
    }
    let upper = req.method.to_ascii_uppercase();
    if !METHODS.contains(&upper.as_str()) {
        return Err(format!("bad_request: unsupported method {}", req.method));
    }
    reqwest::Method::from_bytes(upper.as_bytes()).map_err(|e| format!("bad_request: {e}"))
}

/// Read a response body, failing past `cap` bytes instead of buffering it.
pub async fn read_capped(mut res: reqwest::Response, cap: usize) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("network: {e}"))? {
        if out.len() + chunk.len() > cap {
            return Err(format!(
                "too_large: response is over {} MB",
                cap / (1024 * 1024)
            ));
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

pub fn send_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "timeout: the server took too long to answer".into()
    } else {
        format!("network: {e}")
    }
}

pub async fn fetch(allow: Allow, req: HttpRequest) -> Result<HttpResponse, String> {
    let method = check_request(&allow, &req)?;
    let redirect_allow = allow.clone();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error("too many redirects")
            } else if redirect_allow.allows(attempt.url().as_str()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| format!("network: {e}"))?;
    let mut rb = client.request(method, &req.url);
    for (k, v) in &req.headers {
        if !header_blocked(k) {
            rb = rb.header(k, v);
        }
    }
    if let Some(body) = req.body {
        rb = rb.body(body);
    }
    let res = rb.send().await.map_err(send_error)?;
    let status = res.status().as_u16();
    let headers = res
        .headers()
        .iter()
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|v| (k.as_str().to_string(), v.to_string()))
        })
        .collect();
    let body = read_capped(res, RESPONSE_CAP).await?;
    Ok(HttpResponse {
        status,
        headers,
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(url: &str, method: &str) -> HttpRequest {
        HttpRequest {
            url: url.into(),
            method: method.into(),
            headers: Default::default(),
            body: None,
        }
    }

    #[test]
    fn checks_origin_and_method() {
        let a = Allow {
            patterns: vec!["https://*.atlassian.net".to_string()],
            origins: vec!["https://git.acme.fr:8443".to_string()],
        };
        assert!(check_request(&a, &req("https://acme.atlassian.net/rest", "get")).is_ok());
        assert!(check_request(&a, &req("https://git.acme.fr:8443/api/v4", "GET")).is_ok());
        assert!(check_request(&a, &req("https://evil.com/", "GET"))
            .unwrap_err()
            .starts_with("forbidden:"));
        assert!(
            check_request(&a, &req("https://acme.atlassian.net/", "TRACE"))
                .unwrap_err()
                .starts_with("bad_request:")
        );
    }

    #[test]
    fn drops_hop_headers() {
        assert!(header_blocked("Host"));
        assert!(header_blocked("content-length"));
        assert!(header_blocked("Cookie"));
        assert!(!header_blocked("Authorization"));
        assert!(!header_blocked("Content-Type"));
    }
}
