// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! iOS driver session: keeps the on-device Maestro XCTest HTTP server alive
//! (via `maestro studio`) and reachable (via `iproxy`), and exposes a typed
//! HTTP client for `/viewHierarchy`, `/touch`, `/inputText`, `/swipeV2`,
//! `/screenshot`, `/deviceInfo`, `/status`.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Screen geometry from `GET /deviceInfo`. iOS hierarchy/taps are in POINTS;
/// the screenshot is in PIXELS (points * scale).
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct DeviceInfo {
    #[serde(rename = "widthPoints")]
    pub width_points: u32,
    #[serde(rename = "heightPoints")]
    pub height_points: u32,
    #[serde(rename = "widthPixels")]
    pub width_pixels: u32,
    #[serde(rename = "heightPixels")]
    pub height_pixels: u32,
}

impl DeviceInfo {
    /// pixels-per-point along X (== UIScreen.scale, typically 2.0 or 3.0).
    pub fn scale_x(&self) -> f32 {
        if self.width_points == 0 {
            1.0
        } else {
            self.width_pixels as f32 / self.width_points as f32
        }
    }
    pub fn scale_y(&self) -> f32 {
        if self.height_points == 0 {
            1.0
        } else {
            self.height_pixels as f32 / self.height_points as f32
        }
    }
}

#[derive(Debug, Serialize)]
pub struct TouchBody {
    pub x: f32,
    pub y: f32,
    pub duration: f32,
}

#[derive(Debug, Serialize)]
pub struct SwipeBody {
    #[serde(rename = "startX")]
    pub start_x: f32,
    #[serde(rename = "startY")]
    pub start_y: f32,
    #[serde(rename = "endX")]
    pub end_x: f32,
    #[serde(rename = "endY")]
    pub end_y: f32,
    pub duration: f32,
}

#[derive(Debug, Serialize)]
pub struct InputTextBody {
    pub text: String,
}

/// Typed HTTP client for the on-device XCTest server, reached through the
/// host-side port `iproxy` forwards to device `:22087`.
pub struct IosHttpClient {
    base: String,
    client: reqwest::Client,
}

impl IosHttpClient {
    pub fn new(host_port: u16) -> AppResult<Self> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(1))
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| AppError::IosDriverUnreachable(e.to_string()))?;
        Ok(Self {
            base: format!("http://127.0.0.1:{host_port}"),
            client,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base, path.trim_start_matches('/'))
    }

    pub async fn status(&self) -> bool {
        self.client
            .get(self.url("status"))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    pub async fn device_info(&self) -> AppResult<DeviceInfo> {
        let resp = self
            .client
            .get(self.url("deviceInfo"))
            .send()
            .await
            .map_err(|e| AppError::IosDriverUnreachable(format!("deviceInfo: {e}")))?;
        let resp = resp
            .error_for_status()
            .map_err(|e| AppError::IosDriverUnreachable(format!("deviceInfo: {e}")))?;
        let txt = resp
            .text()
            .await
            .map_err(|e| AppError::IosDriverUnreachable(e.to_string()))?;
        serde_json::from_str(&txt)
            .map_err(|e| AppError::IosCommandFailed(format!("deviceInfo parse: {e}")))
    }

    pub async fn view_hierarchy(&self) -> AppResult<String> {
        let body = serde_json::json!({ "excludeKeyboardElements": false });
        let resp = self
            .client
            .post(self.url("viewHierarchy"))
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::IosDriverUnreachable(format!("viewHierarchy: {e}")))?;
        let resp = resp
            .error_for_status()
            .map_err(|e| AppError::IosDriverUnreachable(format!("viewHierarchy: {e}")))?;
        resp.text()
            .await
            .map_err(|e| AppError::IosDriverUnreachable(e.to_string()))
    }

    pub async fn screenshot(&self) -> AppResult<Vec<u8>> {
        let resp = self
            .client
            .get(self.url("screenshot"))
            .send()
            .await
            .map_err(|e| AppError::IosDriverUnreachable(format!("screenshot: {e}")))?;
        let resp = resp
            .error_for_status()
            .map_err(|e| AppError::IosDriverUnreachable(format!("screenshot: {e}")))?;
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| AppError::IosDriverUnreachable(e.to_string()))?;
        Ok(bytes.to_vec())
    }

    pub async fn touch(&self, x: f32, y: f32, duration: f32) -> AppResult<()> {
        self.post_ok("touch", &TouchBody { x, y, duration }).await
    }
    pub async fn input_text(&self, text: &str) -> AppResult<()> {
        self.post_ok(
            "inputText",
            &InputTextBody {
                text: text.to_string(),
            },
        )
        .await
    }
    pub async fn swipe(&self, b: &SwipeBody) -> AppResult<()> {
        if self.post_ok("swipeV2", b).await.is_ok() {
            return Ok(());
        }
        self.post_ok("swipe", b).await
    }

    async fn post_ok<B: Serialize>(&self, path: &str, body: &B) -> AppResult<()> {
        // A transport failure means the driver isn't reachable (consistent with
        // the GET helpers); a non-2xx status means it was reached but rejected
        // the command.
        let resp = self
            .client
            .post(self.url(path))
            .json(body)
            .send()
            .await
            .map_err(|e| AppError::IosDriverUnreachable(format!("{path}: {e}")))?;
        resp.error_for_status()
            .map_err(|e| AppError::IosCommandFailed(format!("{path}: {e}")))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_device_info_points_and_pixels() {
        let json =
            r#"{"widthPoints":393,"heightPoints":852,"widthPixels":1179,"heightPixels":2556}"#;
        let di: DeviceInfo = serde_json::from_str(json).expect("parse");
        assert_eq!(di.width_points, 393);
        assert_eq!(di.width_pixels, 1179);
        assert_eq!(di.scale_x(), 1179.0 / 393.0);
        assert_eq!(di.scale_y(), 2556.0 / 852.0);
    }

    #[test]
    fn touch_body_serializes_expected_keys() {
        let body = TouchBody {
            x: 100.0,
            y: 200.0,
            duration: 0.0,
        };
        let s = serde_json::to_string(&body).unwrap();
        assert!(s.contains("\"x\":100"), "got {s}");
        assert!(s.contains("\"y\":200"), "got {s}");
        assert!(s.contains("\"duration\":0"), "got {s}");
    }
}
