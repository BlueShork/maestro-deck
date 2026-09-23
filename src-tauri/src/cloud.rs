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
