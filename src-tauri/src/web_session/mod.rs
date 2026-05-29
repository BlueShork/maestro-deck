// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Web driver session: keeps `maestro studio -p web` alive and talks to its
//! HTTP API on 127.0.0.1:9999 (`GET /api/device-screen`, `POST /api/run-command`).
//! The web analogue of `ios_session`. Screen + hierarchy come from one
//! device-screen call; input goes through run-command.

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

/// Default port the Maestro Studio HTTP server binds to.
pub const STUDIO_PORT: u16 = 9999;

/// Parsed `GET /api/device-screen` response.
/// VERIFY (Task 1): field names/screenshot encoding against the captured fixture.
#[derive(Debug, Clone, Deserialize)]
pub struct DeviceScreen {
    /// Screenshot location. Documented as a URL path (e.g. "/screenshot/<id>.png").
    pub screenshot: String,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    /// Raw hierarchy payload, kept as JSON so `hierarchy::web` can adapt it
    /// without this module knowing the tree shape. VERIFY (Task 1): the key
    /// is assumed to be `elements`.
    #[serde(rename = "elements")]
    pub elements: serde_json::Value,
}

/// Typed client for the Maestro Studio web API.
pub struct WebStudioClient {
    base: String,
    client: reqwest::Client,
}

impl WebStudioClient {
    pub fn new(port: u16) -> AppResult<Self> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(1))
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| AppError::Other(format!("web client build: {e}")))?;
        Ok(Self {
            base: format!("http://127.0.0.1:{port}"),
            client,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base, path.trim_start_matches('/'))
    }

    /// `GET /api/device-screen` — screenshot location + hierarchy in one call.
    pub async fn device_screen(&self) -> AppResult<DeviceScreen> {
        let resp = self
            .client
            .get(self.url("api/device-screen"))
            .send()
            .await
            .map_err(|e| AppError::Other(format!("device-screen: {e}")))?
            .error_for_status()
            .map_err(|e| AppError::Other(format!("device-screen: {e}")))?;
        let txt = resp
            .text()
            .await
            .map_err(|e| AppError::Other(e.to_string()))?;
        serde_json::from_str(&txt)
            .map_err(|e| AppError::HierarchyParse(format!("device-screen parse: {e}")))
    }

    /// Fetch PNG bytes for a screenshot path returned by `device_screen`.
    /// If `screenshot` is already an absolute http URL, it is used as-is.
    pub async fn screenshot_png(&self, location: &str) -> AppResult<Vec<u8>> {
        let url = if location.starts_with("http") {
            location.to_string()
        } else {
            self.url(location)
        };
        let resp = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("screenshot: {e}")))?
            .error_for_status()
            .map_err(|e| AppError::Other(format!("screenshot: {e}")))?;
        Ok(resp
            .bytes()
            .await
            .map_err(|e| AppError::Other(e.to_string()))?
            .to_vec())
    }

    /// `POST /api/run-command` — run a single maestro command (tap/text/swipe).
    /// VERIFY (Task 1): the body shape. Documented/assumed: `{ "yaml": "<cmd>" }`.
    pub async fn run_command(&self, body: serde_json::Value) -> AppResult<()> {
        self.client
            .post(self.url("api/run-command"))
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("run-command: {e}")))?
            .error_for_status()
            .map_err(|e| AppError::Other(format!("run-command: {e}")))?;
        Ok(())
    }

    pub async fn is_alive(&self) -> bool {
        self.client
            .get(self.url("api/device-screen"))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}

const READY_ATTEMPTS: u32 = 120;
const READY_BACKOFF_MS: u64 = 500;

fn studio_args() -> Vec<String> {
    // `-p web` selects the web platform. `--no-window` suppresses Studio's own
    // UI tab (we render our own canvas). VERIFY (Task 1): confirm --no-window
    // keeps the API up + launches a headed automated Chromium; drop it if not.
    vec![
        "studio".to_string(),
        "-p".to_string(),
        "web".to_string(),
        "--no-window".to_string(),
    ]
}

/// Keeps `maestro studio -p web` alive and owns the HTTP client for the session.
pub struct WebStudioKeeper {
    http: WebStudioClient,
    studio_child: AsyncMutex<Option<Child>>,
    port: u16,
}

impl WebStudioKeeper {
    pub fn http(&self) -> &WebStudioClient {
        &self.http
    }
    pub fn port(&self) -> u16 {
        self.port
    }

    pub async fn start(port: u16, url: Option<&str>) -> AppResult<Arc<Self>> {
        // Cull any orphan studio from a crashed prior session (mirrors the
        // Android StudioKeeper orphan-kill). Reuse the existing helper.
        crate::hierarchy::studio::kill_orphan_studios_pub().await;

        let maestro = crate::tool_paths::maestro_bin();
        let studio = Command::new(&maestro)
            .args(studio_args())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    AppError::RunnerNotFound
                } else {
                    AppError::Other(format!("maestro studio -p web: {e}"))
                }
            })?;

        let keeper = Arc::new(Self {
            http: WebStudioClient::new(port)?,
            studio_child: AsyncMutex::new(Some(studio)),
            port,
        });

        for attempt in 0..READY_ATTEMPTS {
            if keeper.http.is_alive().await {
                info!(port, "web studio ready");
                // Best-effort navigate the automated browser to the flow's url.
                // VERIFY (Task 1): the exact command — assumed an openLink. If
                // studio ignores it, navigation may instead need a studio arg.
                if let Some(u) = url {
                    let yaml = format!("- openLink: {u}");
                    if let Err(e) = keeper
                        .http
                        .run_command(serde_json::json!({ "yaml": yaml }))
                        .await
                    {
                        warn!(error = %e, "web navigate failed (continuing on current page)");
                    }
                }
                return Ok(keeper);
            }
            if attempt % 10 == 0 {
                info!(port, attempt, "waiting for web studio...");
            }
            if attempt + 1 < READY_ATTEMPTS {
                sleep(Duration::from_millis(READY_BACKOFF_MS)).await;
            }
        }
        keeper.stop().await;
        Err(AppError::Other(
            "maestro studio -p web did not bring up the API on :9999 in time".into(),
        ))
    }

    pub async fn stop(&self) {
        if let Some(mut c) = self.studio_child.lock().await.take() {
            let _ = c.kill().await;
        }
    }
}

const SCREENSHOT_INTERVAL_MS: u64 = 350;
const WEB_FRAME_EVENT: &str = "web_frame";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFramePayload {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Poll `/api/device-screen` -> fetch the PNG -> emit `web_frame` until aborted.
pub fn spawn_screenshot_poller(
    app: AppHandle,
    keeper: Arc<WebStudioKeeper>,
) -> oneshot::Sender<()> {
    let (abort_tx, mut abort_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                biased;
                _ = &mut abort_rx => {
                    info!("web screenshot poller aborted");
                    return;
                }
                screen = keeper.http().device_screen() => {
                    match screen {
                        Ok(s) => match keeper.http().screenshot_png(&s.screenshot).await {
                            Ok(data) => {
                                let payload = WebFramePayload { data, width: s.width, height: s.height };
                                if let Err(e) = app.emit(WEB_FRAME_EVENT, &payload) {
                                    warn!(error = %e, "failed to emit web_frame");
                                }
                            }
                            Err(e) => warn!(error = %e, "web screenshot fetch failed"),
                        },
                        Err(e) => warn!(error = %e, "web device-screen poll failed"),
                    }
                    sleep(Duration::from_millis(SCREENSHOT_INTERVAL_MS)).await;
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
    fn parses_device_screen_fixture() {
        // VERIFY (Task 1): replace with assertions against the captured fixture.
        let json = r#"{"screenshot":"/screenshot/abc.png","width":1280,"height":800,"elements":{"attributes":{},"children":[]}}"#;
        let s: DeviceScreen = serde_json::from_str(json).expect("parse");
        assert_eq!(s.width, 1280);
        assert_eq!(s.screenshot, "/screenshot/abc.png");
    }

    #[test]
    fn studio_args_select_web_platform() {
        let a = studio_args();
        assert!(a.contains(&"web".to_string()));
        assert_eq!(a[0], "studio");
    }
}
