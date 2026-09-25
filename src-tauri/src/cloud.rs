// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Talking to Maestro Deck Cloud.
//!
//! Every cloud request goes through here rather than `fetch` in the webview,
//! because the webview is an origin and the API is not set up for it: only
//! `/api/billing/me` answers a CORS preflight, so a browser-side POST to
//! `/api/jobs/init` is blocked before it is ever sent. Rust is not a browser,
//! so there is no preflight and no origin to allow.
//!
//! Uploads live here for two further reasons: the webview is granted
//! `fs:allow-read-text-file` only, so it cannot read an APK at all, and
//! streaming the file keeps a 100 MB binary out of WebKit's heap.

use std::path::Path;

use serde::Serialize;
use tokio::fs::File;
use tokio_util::codec::{BytesCodec, FramedRead};

use crate::error::{AppError, AppResult};

/// PUT `path` to a pre-signed URL.
///
/// The signature covers the method and the object path, so no auth header is
/// sent — adding one would invalidate the signature. Content-Length comes from
/// the file's own metadata because GCS rejects a chunked PUT on a v4 signature.
#[tauri::command]
pub async fn cloud_upload_file(upload_url: String, path: String) -> AppResult<()> {
    let file_path = Path::new(&path);
    let len = tokio::fs::metadata(file_path).await?.len();
    let file = File::open(file_path).await?;
    let body = reqwest::Body::wrap_stream(FramedRead::new(file, BytesCodec::new()));

    let res = reqwest::Client::new()
        .put(&upload_url)
        .header(reqwest::header::CONTENT_LENGTH, len)
        .body(body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("upload failed: {e}")))?;

    if !res.status().is_success() {
        let status = res.status();
        // A signed URL that has outlived its 15 minute TTL is the likeliest
        // failure here, and it reads as a plain 403 — name it so the user is
        // told to run again rather than left with a bare status code.
        let hint = if status == reqwest::StatusCode::FORBIDDEN {
            " (the upload link may have expired — start the run again)"
        } else {
            ""
        };
        return Err(AppError::Other(format!(
            "upload rejected: HTTP {status}{hint}"
        )));
    }

    Ok(())
}

/// The one host these commands will talk to. Hard-coded rather than taken from
/// the caller so this cannot become a general-purpose request proxy reachable
/// from the webview.
const DASHBOARD_ORIGIN: &str = "https://dashboard.maestrodeck.cloud";

#[derive(Serialize)]
pub struct CloudApiResponse {
    pub status: u16,
    pub body: String,
}

/// Perform an authenticated request against the cloud dashboard API.
///
/// Returns the status and raw body instead of erroring on 4xx/5xx: the caller
/// maps the API's own `{ error, message }` shapes to user-facing wording, and
/// needs the body to do it.
#[tauri::command]
pub async fn cloud_api_request(
    method: String,
    path: String,
    token: String,
    body: Option<String>,
) -> AppResult<CloudApiResponse> {
    if !path.starts_with('/') {
        return Err(AppError::Other(format!("invalid API path: {path}")));
    }

    let client = reqwest::Client::new();
    let url = format!("{DASHBOARD_ORIGIN}{path}");
    let mut req = match method.as_str() {
        "GET" => client.get(url),
        "POST" => client.post(url),
        other => return Err(AppError::Other(format!("unsupported method: {other}"))),
    }
    .bearer_auth(token);

    if let Some(json) = body {
        req = req
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(json);
    }

    let res = req
        .send()
        .await
        .map_err(|e| AppError::Other(format!("cloud request failed: {e}")))?;
    let status = res.status().as_u16();
    let body = res
        .text()
        .await
        .map_err(|e| AppError::Other(format!("cloud response unreadable: {e}")))?;

    Ok(CloudApiResponse { status, body })
}

/// Download a text artifact from its signed URL.
///
/// Restricted to Google Cloud Storage: these URLs come back from the API and
/// are signed, but the command still refuses any other host so a bad response
/// cannot turn this into an open fetcher.
#[tauri::command]
pub async fn cloud_download_text(url: String) -> AppResult<String> {
    if !url.starts_with("https://storage.googleapis.com/") {
        return Err(AppError::Other(
            "refusing to download from that host".into(),
        ));
    }

    let res = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("download failed: {e}")))?;

    if !res.status().is_success() {
        return Err(AppError::Other(format!(
            "download rejected: HTTP {}",
            res.status()
        )));
    }

    res.text()
        .await
        .map_err(|e| AppError::Other(format!("download unreadable: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Serves exactly one request with `status`, and hands back the raw request
    /// (headers and body) it received.
    async fn one_shot_server(status: &'static str) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!(
            "http://{}/bucket/object?sig=1",
            listener.local_addr().unwrap()
        );
        let handle = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut raw = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                let n = sock.read(&mut buf).await.unwrap();
                raw.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&raw).to_string();
                if let Some(head_end) = text.find("\r\n\r\n") {
                    let len = text[..head_end]
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if raw.len() >= head_end + 4 + len {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let reply =
                format!("HTTP/1.1 {status}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
            sock.write_all(reply.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&raw).to_string()
        });
        (url, handle)
    }

    fn temp_file(contents: &[u8]) -> tempfile::NamedTempFile {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        std::io::Write::write_all(&mut f, contents).unwrap();
        f
    }

    #[tokio::test]
    async fn upload_puts_the_file_with_its_exact_length_and_no_auth() {
        let (url, server) = one_shot_server("200 OK").await;
        let file = temp_file(b"fake apk bytes");

        cloud_upload_file(url, file.path().to_string_lossy().into_owned())
            .await
            .unwrap();

        let request = server.await.unwrap();
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("PUT /bucket/object?sig=1 "),
            "{request}"
        );
        // GCS refuses a chunked PUT on a v4 signature.
        assert!(lower.contains("content-length: 14"), "{request}");
        assert!(!lower.contains("transfer-encoding: chunked"), "{request}");
        // An extra auth header would invalidate the signature.
        assert!(!lower.contains("authorization:"), "{request}");
        assert!(request.ends_with("fake apk bytes"), "{request}");
    }

    #[tokio::test]
    async fn an_expired_upload_link_tells_the_user_to_run_again() {
        let (url, server) = one_shot_server("403 Forbidden").await;
        let file = temp_file(b"x");

        let err = cloud_upload_file(url, file.path().to_string_lossy().into_owned())
            .await
            .unwrap_err()
            .to_string();
        server.await.unwrap();

        assert!(err.contains("403"), "{err}");
        assert!(err.contains("start the run again"), "{err}");
    }

    #[tokio::test]
    async fn other_upload_failures_carry_no_expiry_hint() {
        let (url, server) = one_shot_server("500 Internal Server Error").await;
        let file = temp_file(b"x");

        let err = cloud_upload_file(url, file.path().to_string_lossy().into_owned())
            .await
            .unwrap_err()
            .to_string();
        server.await.unwrap();

        assert!(err.contains("500"), "{err}");
        assert!(!err.contains("expired"), "{err}");
    }

    #[tokio::test]
    async fn upload_of_a_missing_file_fails_before_any_request() {
        let err = cloud_upload_file(
            "http://127.0.0.1:9/never".into(),
            "/nonexistent/app.apk".into(),
        )
        .await;
        assert!(err.is_err());
    }

    #[tokio::test]
    async fn api_request_refuses_a_path_that_could_change_the_host() {
        // Without the leading slash, "@evil.test/x" would turn the URL into
        // https://dashboard.maestrodeck.cloud@evil.test/x — credentials for,
        // and a request to, another host.
        for path in ["@evil.test/api", ".evil.test/api", "api/jobs"] {
            let err = cloud_api_request("GET".into(), path.into(), "tok".into(), None)
                .await
                .err()
                .unwrap_or_else(|| panic!("{path} was accepted"))
                .to_string();
            assert!(err.contains("invalid API path"), "{path}: {err}");
        }
    }

    #[tokio::test]
    async fn api_request_only_allows_get_and_post() {
        let err = cloud_api_request("DELETE".into(), "/api/jobs/1".into(), "tok".into(), None)
            .await
            .err()
            .unwrap()
            .to_string();
        assert!(err.contains("unsupported method"), "{err}");
    }

    #[tokio::test]
    async fn download_refuses_anything_but_cloud_storage() {
        for url in [
            "https://storage.googleapis.com.evil.test/log",
            "http://storage.googleapis.com/bucket/log",
            "https://dashboard.maestrodeck.cloud/api/billing/me",
            "file:///etc/passwd",
        ] {
            let err = cloud_download_text(url.into())
                .await
                .err()
                .unwrap_or_else(|| panic!("{url} was accepted"))
                .to_string();
            assert!(err.contains("refusing"), "{url}: {err}");
        }
    }
}
