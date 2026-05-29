// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! iOS driver session: keeps the on-device Maestro XCTest HTTP server alive
//! (via `maestro studio`) and reachable (via `iproxy`), and exposes a typed
//! HTTP client for `/viewHierarchy`, `/touch`, `/inputText`, `/swipeV2`,
//! `/screenshot`, `/deviceInfo`, `/status`.

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::sleep;
use tracing::info;

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

/// Device port the Maestro XCTest runner (FlyingFox) listens on.
pub const DEVICE_PORT: u16 = 22087;
/// Host port we forward to it. Deterministic; chosen to avoid common ranges.
pub const HOST_PORT: u16 = 7010;
/// Readiness probe budget — `maestro studio`'s first build/install on a cold
/// device can take 10–30 s.
const READY_ATTEMPTS: u32 = 120;
const READY_BACKOFF_MS: u64 = 500;

fn studio_args<'a>(udid: &'a str, team_id: Option<&'a str>) -> Vec<&'a str> {
    let mut a = vec!["--device", udid, "studio", "--no-window"];
    if let Some(t) = team_id {
        a.push("--apple-team-id");
        a.push(t);
    }
    a
}

fn iproxy_args(host_port: u16, udid: &str) -> Vec<String> {
    vec![
        "-u".into(),
        udid.to_string(),
        format!("{host_port}:{DEVICE_PORT}"),
    ]
}

/// Keeps the on-device runner alive (`maestro studio`) and reachable (`iproxy`),
/// and owns the HTTP client + cached DeviceInfo for the session.
pub struct IosDriverKeeper {
    udid: String,
    http: IosHttpClient,
    device_info: parking_lot::RwLock<Option<DeviceInfo>>,
    studio_child: AsyncMutex<Option<Child>>,
    iproxy_child: AsyncMutex<Option<Child>>,
}

impl IosDriverKeeper {
    pub fn udid(&self) -> &str {
        &self.udid
    }
    pub fn http(&self) -> &IosHttpClient {
        &self.http
    }
    pub fn device_info(&self) -> Option<DeviceInfo> {
        *self.device_info.read()
    }

    pub async fn start(udid: &str) -> AppResult<Arc<Self>> {
        let maestro = crate::tool_paths::maestro_bin();
        let team = crate::tool_paths::apple_team_id();
        let args = studio_args(udid, team.as_deref());
        let studio = Command::new(&maestro)
            .args(args)
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    AppError::RunnerNotFound
                } else {
                    AppError::IosCommandFailed(format!("maestro studio: {e}"))
                }
            })?;

        let iproxy = crate::tool_paths::iproxy_bin();
        let ipx = Command::new(&iproxy)
            .args(iproxy_args(HOST_PORT, udid))
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    AppError::IosToolMissing("iproxy not found — `brew install libusbmuxd`".into())
                } else {
                    AppError::IosCommandFailed(format!("iproxy: {e}"))
                }
            })?;

        // If `IosHttpClient::new` fails here, `studio` and `ipx` are dropped on
        // the way out and `kill_on_drop(true)` terminates both — no orphans.
        let keeper = Arc::new(Self {
            udid: udid.to_string(),
            http: IosHttpClient::new(HOST_PORT)?,
            device_info: parking_lot::RwLock::new(None),
            studio_child: AsyncMutex::new(Some(studio)),
            iproxy_child: AsyncMutex::new(Some(ipx)),
        });

        for attempt in 0..READY_ATTEMPTS {
            if keeper.http.status().await {
                if let Ok(di) = keeper.http.device_info().await {
                    *keeper.device_info.write() = Some(di);
                    info!(udid, "iOS driver ready");
                    return Ok(keeper);
                }
            }
            if attempt % 10 == 0 {
                info!(udid, attempt, "waiting for iOS driver...");
            }
            // Skip the final sleep so the failure path doesn't waste a backoff.
            if attempt + 1 < READY_ATTEMPTS {
                sleep(std::time::Duration::from_millis(READY_BACKOFF_MS)).await;
            }
        }
        keeper.stop().await;
        Err(AppError::IosDriverUnreachable(
            "maestro studio did not bring up the XCTest server on :22087 in time".into(),
        ))
    }

    pub async fn stop(&self) {
        if let Some(mut c) = self.studio_child.lock().await.take() {
            let _ = c.kill().await;
        }
        if let Some(mut c) = self.iproxy_child.lock().await.take() {
            let _ = c.kill().await;
        }
    }

    /// Cheap liveness check used by the screenshot poller / command preflight.
    pub async fn is_alive(&self) -> bool {
        self.http.status().await
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

    #[test]
    fn builds_studio_args_with_team_id() {
        let args = studio_args("UDID-1", Some("TEAM123"));
        assert_eq!(
            args,
            vec![
                "--device",
                "UDID-1",
                "studio",
                "--no-window",
                "--apple-team-id",
                "TEAM123"
            ]
        );
    }

    #[test]
    fn builds_studio_args_without_team_id() {
        let args = studio_args("UDID-1", None);
        assert_eq!(args, vec!["--device", "UDID-1", "studio", "--no-window"]);
    }

    #[test]
    fn builds_iproxy_args() {
        assert_eq!(
            iproxy_args(7010, "UDID-1"),
            vec!["-u", "UDID-1", "7010:22087"]
        );
    }
}
