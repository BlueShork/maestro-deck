// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! iOS Simulator driver session: boots a simulator and lets `maestro studio`
//! install/launch/hold the on-device XCTest HTTP server, which on a simulator
//! is reachable directly on `127.0.0.1:22087` (the sim shares the host network —
//! no forwarding/tunnel). Exposes a typed HTTP client for `/viewHierarchy`,
//! `/touch`, `/inputText`, `/swipeV2`, `/screenshot`, `/deviceInfo`, `/status`.

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::process::{Child, Command};
use tokio::sync::oneshot;
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::sleep;
use tracing::{info, warn};

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
pub struct PressButtonBody {
    /// XCTest server `PressButtonRequest.Button` raw value: `"home"` or `"lock"`.
    pub button: String,
}

#[derive(Debug, Serialize)]
pub struct InputTextBody {
    pub text: String,
    // Required by the v2.5.1 XCTest server (`InputTextRequest`). The server
    // auto-detects the foreground app, so an empty list is accepted.
    #[serde(rename = "appIds")]
    pub app_ids: Vec<String>,
}

/// Typed HTTP client for the on-device XCTest server. On a simulator the server
/// is reachable directly on `127.0.0.1:22087` (the sim shares the host network).
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
        // v2.5.1's `ViewHierarchyRequest` requires `appIds` (server auto-detects
        // the foreground app, so an empty list is accepted). Omitting it yields
        // 400 "incorrect request body provided".
        let body = serde_json::json!({ "appIds": [], "excludeKeyboardElements": false });
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
                app_ids: Vec::new(),
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
    /// Press a hardware button via the XCTest `/pressButton` route
    /// (`XCUIDevice.shared.press(.home)`). `button` is the server's raw value
    /// (`"home"` or `"lock"`).
    pub async fn press_button(&self, button: &str) -> AppResult<()> {
        self.post_ok(
            "pressButton",
            &PressButtonBody {
                button: button.to_string(),
            },
        )
        .await
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

/// Port the Maestro XCTest runner serves on. On a SIMULATOR this is reachable
/// directly on the host loopback (the sim shares the host network) — no iproxy,
/// no tunnel.
pub const DRIVER_PORT: u16 = 22087;
/// Generous readiness budget: a cold simulator + first runner install can take
/// well over a minute. ~180 s total.
const READY_ATTEMPTS: u32 = 360;
const READY_BACKOFF_MS: u64 = 500;
/// Passed to maestro as MAESTRO_DRIVER_STARTUP_TIMEOUT so it doesn't give up on
/// a cold simulator before the driver is ready (ms).
const DRIVER_STARTUP_TIMEOUT_MS: &str = "120000";

fn studio_args(udid: &str) -> Vec<&str> {
    vec!["--device", udid, "studio", "--no-window"]
}

/// Boots a simulator + lets `maestro studio` install/launch/hold the XCUITest
/// runner on it, and owns the HTTP client + cached DeviceInfo for the session.
pub struct IosDriverKeeper {
    udid: String,
    http: IosHttpClient,
    device_info: parking_lot::RwLock<Option<DeviceInfo>>,
    studio_child: AsyncMutex<Option<Child>>,
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

    /// True once the driver has served real data at least once (cached). Cheap, no I/O.
    pub fn is_ready(&self) -> bool {
        self.device_info.read().is_some()
    }

    /// Boot the simulator and spawn `maestro studio` (installs/launches the XCTest
    /// runner). Returns IMMEDIATELY — does NOT wait for readiness (~2 min cold).
    /// Call `wait_until_ready` before issuing driver requests (hierarchy/input).
    pub async fn spawn(udid: &str) -> AppResult<Arc<Self>> {
        // Boot the sim (idempotent — `simctl boot` errors if already booted, ignored).
        let _ = Command::new("xcrun")
            .args(["simctl", "boot", udid])
            .output()
            .await;

        let maestro = crate::tool_paths::maestro_bin();
        let studio = Command::new(&maestro)
            .args(studio_args(udid))
            .env("MAESTRO_DRIVER_STARTUP_TIMEOUT", DRIVER_STARTUP_TIMEOUT_MS)
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    AppError::RunnerNotFound
                } else {
                    AppError::IosCommandFailed(format!("maestro studio: {e}"))
                }
            })?;

        Ok(Arc::new(Self {
            udid: udid.to_string(),
            http: IosHttpClient::new(DRIVER_PORT)?,
            device_info: parking_lot::RwLock::new(None),
            studio_child: AsyncMutex::new(Some(studio)),
        }))
    }

    /// Probe `/status` + `/deviceInfo` until the runner serves real data, caching
    /// the geometry. Returns `true` once ready (instantly if already ready),
    /// `false` after the ~180 s budget. Safe to call concurrently.
    pub async fn wait_until_ready(&self) -> bool {
        if self.is_ready() {
            return true;
        }
        for attempt in 0..READY_ATTEMPTS {
            // Bail out promptly if `maestro studio` exited (e.g. the session was
            // torn down on disconnect/run) instead of probing a dead socket for
            // the full budget.
            if !self.is_process_alive().await {
                return false;
            }
            if self.http.status().await {
                if let Ok(di) = self.http.device_info().await {
                    *self.device_info.write() = Some(di);
                    info!(udid = %self.udid, "iOS simulator driver ready");
                    return true;
                }
            }
            if attempt % 10 == 0 {
                info!(udid = %self.udid, attempt, "waiting for iOS simulator driver...");
            }
            if attempt + 1 < READY_ATTEMPTS {
                sleep(std::time::Duration::from_millis(READY_BACKOFF_MS)).await;
            }
        }
        false
    }

    pub async fn stop(&self) {
        if let Some(mut c) = self.studio_child.lock().await.take() {
            let _ = c.kill().await;
        }
        // Leave the simulator booted for reuse.
    }

    /// True while the `maestro studio` child is still running (regardless of
    /// driver readiness). Used to decide whether a cached keeper is reusable.
    pub async fn is_process_alive(&self) -> bool {
        match self.studio_child.lock().await.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        }
    }

    /// Cheap HTTP liveness check.
    pub async fn is_alive(&self) -> bool {
        self.http.status().await
    }
}

/// Poll interval for the V1 screenshot preview (~3 fps). Live mirror is V2.
const SCREENSHOT_INTERVAL_MS: u64 = 350;
const IOS_FRAME_EVENT: &str = "ios_frame";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IosFramePayload {
    /// PNG bytes from `GET /screenshot` (native pixels).
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Capture a PNG screenshot of the booted simulator via `simctl`. The XCTest
/// `/screenshot` HTTP route is unreliable on simulators (the connection is
/// reset). `simctl io … screenshot -` (stdout) is also unsupported on this
/// macOS (it tries to create a file literally named `-`), so we write to a
/// per-UDID temp file, read it back, and overwrite it each poll. Output is a
/// native-resolution (pixel) PNG.
async fn capture_simulator_screenshot(udid: &str) -> AppResult<Vec<u8>> {
    let path = std::env::temp_dir().join(format!("maestro-deck-ios-{udid}.png"));
    let path_str = path.to_string_lossy().to_string();
    let out = Command::new("xcrun")
        .args(["simctl", "io", udid, "screenshot", "--type=png", &path_str])
        .output()
        .await
        .map_err(|e| AppError::IosCommandFailed(format!("simctl screenshot: {e}")))?;
    if !out.status.success() {
        return Err(AppError::IosDriverUnreachable(format!(
            "simctl screenshot failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    tokio::fs::read(&path)
        .await
        .map_err(|e| AppError::IosCommandFailed(format!("read screenshot file: {e}")))
}

/// Spawn a task that captures the simulator screen and emits `ios_frame` until
/// aborted. Returns the abort sender to store in `AppState.ios_screenshot_abort`.
pub fn spawn_screenshot_poller(
    app: AppHandle,
    keeper: Arc<IosDriverKeeper>,
) -> oneshot::Sender<()> {
    let (abort_tx, mut abort_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let (w, h) = keeper
            .device_info()
            .map(|d| (d.width_pixels, d.height_pixels))
            .unwrap_or((0, 0));
        loop {
            tokio::select! {
                biased;
                _ = &mut abort_rx => {
                    info!("iOS screenshot poller aborted");
                    return;
                }
                shot = capture_simulator_screenshot(keeper.udid()) => {
                    match shot {
                        Ok(data) => {
                            let payload = IosFramePayload { data, width: w, height: h };
                            if let Err(e) = app.emit(IOS_FRAME_EVENT, &payload) {
                                warn!(error = %e, "failed to emit ios_frame");
                            }
                        }
                        Err(e) => warn!(error = %e, "screenshot poll failed"),
                    }
                    sleep(std::time::Duration::from_millis(SCREENSHOT_INTERVAL_MS)).await;
                }
            }
        }
    });
    abort_tx
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
    fn press_button_body_serializes_home() {
        // Must match the XCTest server's `PressButtonRequest{button:"home"}`.
        let s = serde_json::to_string(&PressButtonBody {
            button: "home".into(),
        })
        .unwrap();
        assert_eq!(s, r#"{"button":"home"}"#);
    }

    #[test]
    fn builds_studio_args() {
        assert_eq!(
            studio_args("UDID-1"),
            vec!["--device", "UDID-1", "studio", "--no-window"]
        );
    }
}
