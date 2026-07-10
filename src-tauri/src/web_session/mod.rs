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
use crate::process_ext::CommandExtNoWindow;

/// Default port the Maestro Studio HTTP server binds to.
pub const STUDIO_PORT: u16 = 9999;

/// Command-line needles (ordered substrings) identifying a **web** maestro
/// studio — the `-p web` needle is what keeps a mobile studio session safe
/// from this sweep. Matched against the JVM's full command line.
pub(crate) const WEB_STUDIO_NEEDLES: &[&str] = &["maestro", "-p web", "studio"];
const CHROMEDRIVER_NEEDLES: &[&str] = &["selenium", "chromedriver"];
const WEBDRIVER_CHROME_NEEDLES: &[&str] = &["test-type=webdriver"];

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

    /// Read one event from the Server-Sent-Events stream `GET
    /// /api/device-screen/sse` — Maestro Studio pushes the current screen
    /// (screenshot URL + flat element list) as `data: {json}\n\n`. We open the
    /// stream, return the first complete event, and drop the connection.
    pub async fn device_screen(&self) -> AppResult<DeviceScreen> {
        let mut resp = self
            .client
            .get(self.url("api/device-screen/sse"))
            .send()
            .await
            .map_err(|e| AppError::Other(format!("device-screen/sse: {e}")))?
            .error_for_status()
            .map_err(|e| AppError::Other(format!("device-screen/sse: {e}")))?;
        let mut buf: Vec<u8> = Vec::new();
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| AppError::Other(format!("device-screen/sse read: {e}")))?
        {
            buf.extend_from_slice(&chunk);
            if let Some(json) = extract_sse_data(&buf) {
                return serde_json::from_str(&json)
                    .map_err(|e| AppError::HierarchyParse(format!("device-screen parse: {e}")));
            }
        }
        Err(AppError::Other(
            "device-screen/sse closed before delivering an event".into(),
        ))
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

    /// `POST /api/run-command` — run a single maestro command. Studio expects
    /// `{ "yaml": "<command yaml>", "dryRun": bool }`.
    pub async fn run_command(&self, body: serde_json::Value) -> AppResult<()> {
        let resp = self
            .client
            .post(self.url("api/run-command"))
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("run-command: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            // Surface the server's explanation (e.g. "Invalid command format")
            // and the offending yaml — a bare status code is useless to debug.
            let detail = resp.text().await.unwrap_or_default();
            let sent = body
                .get("yaml")
                .and_then(|v| v.as_str())
                .unwrap_or("<none>");
            return Err(AppError::Other(format!(
                "run-command {status}: {} | sent yaml: {sent}",
                detail.trim()
            )));
        }
        Ok(())
    }

    /// Liveness: the SPA serves 200 on every path, so a bare GET can't tell us
    /// the driver is ready. Reading a real device-screen event can.
    pub async fn is_alive(&self) -> bool {
        self.device_screen().await.is_ok()
    }
}

/// Extract the JSON payload of the first complete `data: …` line in an SSE
/// buffer. Returns `None` until a full line (terminated by `\n`) is present.
fn extract_sse_data(buf: &[u8]) -> Option<String> {
    let s = std::str::from_utf8(buf).ok()?;
    let start = s.find("data: ")? + "data: ".len();
    let rel_end = s[start..].find('\n')?;
    Some(s[start..start + rel_end].trim().to_string())
}

/// Classify who (if anyone) is holding the web studio port.
#[derive(Debug)]
pub(crate) enum PortOwnerKind {
    /// A leftover `maestro -p web studio` — safe to kill (our sweep does).
    OrphanWebStudio,
    /// A mobile (iOS/Android) studio — belongs to a live session, never kill.
    MobileStudio,
    /// Anything else (another tool squatting the port).
    Foreign,
}

pub(crate) fn classify_port_owner(cmdline: &str) -> PortOwnerKind {
    if crate::prockill::cmdline_matches(cmdline, WEB_STUDIO_NEEDLES) {
        PortOwnerKind::OrphanWebStudio
    } else if crate::prockill::cmdline_matches(cmdline, &["maestro", "studio"]) {
        PortOwnerKind::MobileStudio
    } else {
        PortOwnerKind::Foreign
    }
}

/// Connect-progress event consumed by the frontend toast layer.
const WEB_STATUS_EVENT: &str = "web:status";

fn emit_status(app: Option<&AppHandle>, stage: &str, message: &str) {
    if let Some(app) = app {
        let _ = app.emit(
            WEB_STATUS_EVENT,
            serde_json::json!({ "stage": stage, "message": message }),
        );
    }
}

const READY_ATTEMPTS: u32 = 240;
const READY_BACKOFF_MS: u64 = 500;

fn studio_args() -> Vec<String> {
    // `-p web` is a GLOBAL flag and MUST precede the `studio` subcommand
    // (`maestro -p web studio …`); placing it after `studio` is rejected
    // ("Unknown options: '-p', 'web'") on maestro 2.5.1. `--no-window`
    // suppresses Studio's own UI tab — we render our own canvas.
    vec![
        "-p".to_string(),
        "web".to_string(),
        "studio".to_string(),
        "--no-window".to_string(),
    ]
}

/// Kill orphaned Chromium automation processes left behind by
/// `maestro studio -p web`. Maestro drives Chrome through a Selenium-managed
/// `chromedriver`; killing the studio JVM reaps neither the driver nor the
/// browser, so headed Chrome windows pile up across sessions. We match the
/// Selenium chromedriver and the `--test-type=webdriver` Chrome it launches —
/// markers a user's normal Chrome never carries. Cross-platform via
/// `prockill` (`ps`+`kill` / PowerShell+`taskkill`).
async fn kill_orphan_web_browsers() {
    crate::prockill::kill_matching(CHROMEDRIVER_NEEDLES, "orphan chromedriver").await;
    crate::prockill::kill_matching(WEBDRIVER_CHROME_NEEDLES, "orphan webdriver Chrome").await;
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

    pub async fn start(
        port: u16,
        url: Option<&str>,
        app: Option<&AppHandle>,
    ) -> AppResult<Arc<Self>> {
        // Pre-flight: :9999 is Studio's only possible port. Fail fast with a
        // nameable culprit instead of burning the 60 s ready budget in silence.
        if let Some(owner) = crate::prockill::port_owner(port).await {
            match classify_port_owner(&owner.cmdline) {
                PortOwnerKind::OrphanWebStudio => {
                    // The sweep below reaps it before we spawn ours.
                }
                PortOwnerKind::MobileStudio => {
                    // `connect_device` retires the iOS keeper before a web connect,
                    // but its stop() is async — give the port a moment to free.
                    let mut freed = false;
                    for _ in 0..15 {
                        sleep(Duration::from_millis(200)).await;
                        if crate::prockill::port_owner(port).await.is_none() {
                            freed = true;
                            break;
                        }
                    }
                    if !freed {
                        return Err(AppError::Other(format!(
                            "Studio port :{port} is still held by a mobile maestro \
                             studio session (pid {}). Disconnect the simulator, then \
                             retry the web connect.",
                            owner.pid
                        )));
                    }
                }
                PortOwnerKind::Foreign => {
                    return Err(AppError::Other(format!(
                        "Studio port :{port} is taken by another process (pid {}: {}). \
                         Stop it, then retry the web connect.",
                        owner.pid,
                        owner.cmdline.chars().take(120).collect::<String>()
                    )));
                }
            }
        }

        // Cull any orphan studio from a crashed prior session. Scoped: only web studios;
        // a live iOS/Android studio session belonging to this app (or anything else)
        // is never touched.
        crate::prockill::kill_matching(WEB_STUDIO_NEEDLES, "orphan web studio").await;
        kill_orphan_web_browsers().await;

        let maestro = crate::tool_paths::maestro_bin();
        let studio = Command::new(&maestro)
            .no_window()
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

        emit_status(app, "info", "Starting Chromium…");
        for attempt in 0..READY_ATTEMPTS {
            if keeper.http.is_alive().await {
                info!(port, "web studio ready");
                emit_status(app, "info", "Web browser ready");
                if let Some(u) = url {
                    let yaml = format!("openLink: {u}");
                    if let Err(e) = keeper
                        .http
                        .run_command(serde_json::json!({ "yaml": yaml }))
                        .await
                    {
                        warn!(error = %e, "web navigate failed (continuing on current page)");
                        emit_status(
                            app,
                            "warn",
                            "Couldn't open the flow's url: — the browser stays on its current page.",
                        );
                    }
                }
                return Ok(keeper);
            }
            // A studio that died (bad install, port race we lost) will never become
            // ready — surface its exit immediately instead of waiting out the budget.
            if let Some(child) = keeper.studio_child.lock().await.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    keeper.stop().await;
                    return Err(AppError::Other(format!(
                        "maestro studio -p web exited during startup ({status}). \
                         Run `maestro -p web studio` in a terminal to see its error."
                    )));
                }
            }
            if attempt % 10 == 0 {
                info!(port, attempt, "waiting for web studio...");
            }
            if attempt == 20 {
                // 10 s in: on a cold start maestro may be downloading Chromium.
                emit_status(
                    app,
                    "info",
                    "Still starting — first run may download Chromium…",
                );
            }
            if attempt + 1 < READY_ATTEMPTS {
                sleep(Duration::from_millis(READY_BACKOFF_MS)).await;
            }
        }
        keeper.stop().await;
        Err(AppError::Other(
            "maestro studio -p web did not bring up the API on :9999 in time. \
             Run `maestro -p web studio` in a terminal to check it works."
                .into(),
        ))
    }

    pub async fn stop(&self) {
        if let Some(mut c) = self.studio_child.lock().await.take() {
            let _ = c.kill().await;
        }
        // Killing the studio JVM orphans the chromedriver + Chrome it spawned;
        // reap them so the window closes instead of lingering.
        kill_orphan_web_browsers().await;
    }
}

const SCREENSHOT_INTERVAL_MS: u64 = 350;
const WEB_FRAME_EVENT: &str = "web_frame";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFramePayload {
    /// PNG bytes, **base64-encoded** — see `IosFramePayload::data` for why
    /// (raw `Vec<u8>` serializes as a JSON number array and chokes the webview).
    pub data: String,
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
                                use base64::Engine as _;
                                let payload = WebFramePayload {
                                    data: base64::engine::general_purpose::STANDARD.encode(&data),
                                    width: s.width,
                                    height: s.height,
                                };
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
    fn parses_device_screen_event() {
        // Shape captured from a real `maestro -p web studio` SSE event.
        let json = r#"{"platform":"WEB","screenshot":"/screenshot/abc.png","width":1200,"height":766,"url":"https://x","elements":[{"id":"Search","bounds":{"x":413,"y":14,"width":338,"height":37},"resourceId":"Search","text":"Search…"}]}"#;
        let s: DeviceScreen = serde_json::from_str(json).expect("parse");
        assert_eq!(s.width, 1200);
        assert_eq!(s.screenshot, "/screenshot/abc.png");
        assert!(s.elements.is_array());
    }

    #[test]
    fn extracts_first_sse_data_line() {
        // Only a newline-terminated `data:` line counts as complete.
        assert_eq!(extract_sse_data(b"data: {\"a\":1}"), None);
        assert_eq!(
            extract_sse_data(b"data: {\"a\":1}\n\n").as_deref(),
            Some("{\"a\":1}")
        );
        assert!(extract_sse_data(b":comment\n").is_none());
    }

    #[test]
    fn studio_args_select_web_platform() {
        let a = studio_args();
        // `-p web` must come before the `studio` subcommand.
        assert_eq!(a[0], "-p");
        assert_eq!(a[1], "web");
        assert_eq!(a[2], "studio");
    }

    #[test]
    fn web_sweep_needles_are_scoped_to_web_studios() {
        // Regression: the old sweep (`pgrep maestro.*studio`) killed the iOS
        // simulator studio session. The scoped needles must not.
        let ios = "java -classpath /opt/homebrew/Cellar/maestro/2.5.1/libexec/lib/* maestro.cli.AppKt --device ABC studio --no-window";
        let web = "java -classpath /opt/homebrew/Cellar/maestro/2.5.1/libexec/lib/* maestro.cli.AppKt -p web studio --no-window";
        assert!(crate::prockill::cmdline_matches(web, WEB_STUDIO_NEEDLES));
        assert!(!crate::prockill::cmdline_matches(ios, WEB_STUDIO_NEEDLES));
    }

    #[test]
    fn preflight_classifies_port_owners() {
        let web = "java -cp maestro/lib maestro.cli.AppKt -p web studio --no-window";
        let ios = "java -cp maestro/lib maestro.cli.AppKt --device ABC studio --no-window";
        let foreign = "/usr/bin/python3 -m http.server 9999";
        assert!(matches!(
            classify_port_owner(web),
            PortOwnerKind::OrphanWebStudio
        ));
        assert!(matches!(
            classify_port_owner(ios),
            PortOwnerKind::MobileStudio
        ));
        assert!(matches!(
            classify_port_owner(foreign),
            PortOwnerKind::Foreign
        ));
    }
}
