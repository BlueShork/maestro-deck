// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Uploading job inputs to Google Cloud Storage.
//!
//! The dashboard hands out pre-signed PUT URLs and the client writes straight
//! to the bucket. This lives in Rust rather than the webview for two reasons:
//! the webview is granted `fs:allow-read-text-file` only, so it cannot read an
//! APK at all, and streaming the file keeps a 100 MB binary out of WebKit's
//! heap on its way back out over the network.

use std::path::Path;

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
