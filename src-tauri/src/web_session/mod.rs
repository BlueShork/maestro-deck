// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Web driver session: keeps a `maestro -p web mcp` keeper alive — its
//! device session owns a Selenium-driven Chrome — and drives it through MCP
//! tools (`run` for commands, `inspect_screen` for the hierarchy). The live
//! preview is a CDP screencast of that same Chrome. The web analogue of
//! `ios_session`. (Maestro ≤ 2.5 exposed all this through `maestro studio`'s
//! HTTP API, removed in 2.6.)

pub(crate) mod cdp;
pub mod run_mirror;

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
#[cfg(any(target_os = "macos", windows))]
use tokio::process::Command;
use tokio::sync::oneshot;
use tokio::time::sleep;
use tracing::{info, warn};

use crate::error::{AppError, AppResult};
use crate::maestro_mcp::McpClient;
#[cfg(windows)]
use crate::process_ext::CommandExtNoWindow;

/// MCP device id of the browser session (`McpMaestroSessionManager`).
const WEB_DEVICE_ID: &str = "chromium";

/// Command-line needles (ordered substrings) identifying a **web** keeper
/// (`maestro -p web mcp --no-viewer`) — the `-p web` needle is what keeps a
/// mobile keeper, or a user's own `maestro mcp`, safe from this sweep.
/// Matched against the JVM's full command line.
pub(crate) const WEB_KEEPER_NEEDLES: &[&str] = &["maestro", "-p web", "mcp", "--no-viewer"];
const CHROMEDRIVER_NEEDLES: &[&str] = &["selenium", "chromedriver"];
const WEBDRIVER_CHROME_NEEDLES: &[&str] = &["test-type=webdriver"];

/// First navigation launches Chromium, which can take tens of seconds (a cold
/// start may download the browser + driver).
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(120);
/// A single command. Generous: a `tapOn` on a missing element waits out
/// maestro's own ~17 s lookup before failing.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(60);
const INSPECT_TIMEOUT: Duration = Duration::from_secs(30);

/// A snapshot of the browser screen, in the flat element format the tap
/// resolver (`input::web`) and the inspector (`hierarchy::web`) consume.
#[derive(Debug, Clone)]
pub struct DeviceScreen {
    /// Viewport size in CSS pixels — the space the element bounds live in.
    pub width: u32,
    pub height: u32,
    /// Flat list of `{bounds:{x,y,width,height}, resourceId?, text?}`.
    pub elements: serde_json::Value,
    /// Current page URL, when known. Remembered so a respawned keeper can
    /// restore the user's page.
    pub url: Option<String>,
}

/// Pages that must never be "remembered" as the user's page: Chrome's
/// initial `data:,` and blank pages — restoring to them on respawn would
/// lose the user's real page.
fn is_placeholder_url(url: &str) -> bool {
    url.starts_with("data:") || url.starts_with("about:") || url.starts_with("chrome:")
}

/// Parse maestro's `[left,top][right,bottom]` bounds string.
fn parse_bounds(b: &str) -> Option<(i32, i32, i32, i32)> {
    let nums: Vec<i32> = b
        .split(|c: char| !(c.is_ascii_digit() || c == '-'))
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().ok())
        .collect::<Option<_>>()?;
    match nums[..] {
        [l, t, r, b] => Some((l, t, r, b)),
        _ => None,
    }
}

/// Convert `inspect_screen`'s compact JSON (`{ui_schema, elements:[tree]}`,
/// abbreviated keys, children under `c`) into the flat element list +
/// viewport. Only elements a selector can target (text or id) are kept; the
/// viewport is the root's extent.
fn flatten_inspect_screen(json: &str) -> AppResult<(serde_json::Value, (u32, u32))> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| AppError::HierarchyParse(format!("inspect_screen parse: {e}")))?;
    let roots = v["elements"]
        .as_array()
        .ok_or_else(|| AppError::HierarchyParse("inspect_screen: no `elements`".into()))?;

    let mut viewport = (0u32, 0u32);
    for r in roots {
        if let Some((_, _, right, bottom)) = r["b"].as_str().and_then(parse_bounds) {
            viewport.0 = viewport.0.max(right.max(0) as u32);
            viewport.1 = viewport.1.max(bottom.max(0) as u32);
        }
    }

    let mut out = Vec::new();
    let mut stack: Vec<&serde_json::Value> = roots.iter().rev().collect();
    while let Some(node) = stack.pop() {
        if let Some(children) = node["c"].as_array() {
            stack.extend(children.iter().rev());
        }
        let Some((l, t, r, b)) = node["b"].as_str().and_then(parse_bounds) else {
            continue;
        };
        let non_empty = |k: &str| node[k].as_str().filter(|s| !s.is_empty());
        let resource_id = non_empty("rid");
        // `text:` selectors also match accessibility text and hints.
        let text = non_empty("txt")
            .or_else(|| non_empty("a11y"))
            .or_else(|| non_empty("hint"));
        if resource_id.is_none() && text.is_none() {
            continue;
        }
        let mut el = serde_json::json!({
            "bounds": { "x": l, "y": t, "width": r - l, "height": b - t },
        });
        if let Some(id) = resource_id {
            el["resourceId"] = id.into();
        }
        if let Some(text) = text {
            el["text"] = text.into();
        }
        out.push(el);
    }
    Ok((serde_json::Value::Array(out), viewport))
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

/// True for the driven Chrome's MAIN process: it carries the webdriver
/// marker but no `--type=` (helpers/renderers/GPU children do). The main
/// process is the one owning the window we want to hide.
fn is_main_browser_process(cmdline: &str) -> bool {
    cmdline.contains("test-type=webdriver") && !cmdline.contains("--type=")
}

/// Hide a process's window(s) at the OS level. `maestro mcp` has no
/// headless mode (its web session is hardcoded headed), so the
/// only way to keep the driven Chrome off the user's screen is to hide it
/// after launch. Chrome keeps rendering while hidden — it is launched with
/// `--disable-backgrounding-occluded-windows`, so the SSE preview stays live.
#[cfg(target_os = "macos")]
async fn hide_window(pid: u32) -> bool {
    // Requires the app to be allowed under System Settings > Privacy &
    // Security > Accessibility (System Events scripting).
    let script =
        format!("tell application \"System Events\" to set visible of (first process whose unix id is {pid}) to false");
    Command::new("osascript")
        .args(["-e", &script])
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(windows)]
async fn hide_window(pid: u32) -> bool {
    // SW_HIDE (0) on the process's main window via user32.
    let ps = format!(
        "$sig='[DllImport(\"user32.dll\")]public static extern bool ShowWindowAsync(IntPtr h,int n);';\
         Add-Type -MemberDefinition $sig -Name W -Namespace N;\
         $p=Get-Process -Id {pid} -ErrorAction SilentlyContinue;\
         if ($p -and $p.MainWindowHandle -ne 0) {{ [N.W]::ShowWindowAsync($p.MainWindowHandle,0) }} else {{ $false }}"
    );
    Command::new("powershell")
        .no_window()
        .args(["-NoProfile", "-Command", &ps])
        .output()
        .await
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("True"))
        .unwrap_or(false)
}

#[cfg(all(unix, not(target_os = "macos")))]
async fn hide_window(_pid: u32) -> bool {
    false // No portable window control on Linux; the window stays visible.
}

/// Background task: hide the driven Chrome's window as soon as it appears.
/// Spawned right BEFORE the browser is triggered, polling fast (200 ms) so
/// the window is caught within a blink of existing — waiting for full
/// readiness left it on screen for the whole page load. A cold start may
/// download Chromium, hence the generous overall budget. On macOS a refusal
/// means the Automation/Accessibility permission is missing — surface that.
fn spawn_window_hider(app: Option<AppHandle>) {
    tokio::spawn(async move {
        // A refusal on an EXISTING process can be transient (Chrome not yet
        // scriptable right after spawn) — only after several consecutive
        // refusals do we conclude the OS permission is missing.
        let mut refusals = 0u32;
        let mut denied = false;
        for _ in 0..300 {
            let mains: Vec<u32> = crate::prockill::pids_matching(WEBDRIVER_CHROME_NEEDLES)
                .await
                .into_iter()
                .filter(|(_, cmd)| is_main_browser_process(cmd))
                .map(|(pid, _)| pid)
                .collect();
            if !mains.is_empty() {
                let mut all_hidden = true;
                for pid in mains {
                    all_hidden &= hide_window(pid).await;
                }
                if all_hidden {
                    info!("driven Chrome window hidden");
                    return;
                }
                refusals += 1;
                if refusals >= 10 {
                    denied = true;
                    break;
                }
            }
            sleep(Duration::from_millis(200)).await;
        }
        #[cfg(target_os = "macos")]
        if denied {
            emit_status(
                app.as_ref(),
                "warn",
                "Couldn't hide the Chrome window — allow Maestro Deck under \
                 System Settings > Privacy & Security > Automation (System \
                 Events), then reconnect.",
            );
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, denied);
    });
}

/// Kill orphaned Chromium automation processes left behind by a web keeper.
/// Maestro drives Chrome through a Selenium-managed `chromedriver`; killing
/// the keeper JVM reaps neither the driver nor the browser, so headed Chrome
/// windows pile up across sessions. We match the Selenium chromedriver and
/// the `--test-type=webdriver` Chrome it launches — markers a user's normal
/// Chrome never carries. Cross-platform via `prockill`.
async fn kill_orphan_web_browsers() {
    crate::prockill::kill_matching(CHROMEDRIVER_NEEDLES, "orphan chromedriver").await;
    crate::prockill::kill_matching(WEBDRIVER_CHROME_NEEDLES, "orphan webdriver Chrome").await;
}

/// Keeps a `maestro -p web mcp` keeper (and the Chrome its session owns)
/// alive for the web session.
pub struct WebDriverKeeper {
    mcp: McpClient,
    /// DevTools port of the keeper's Chrome, found after launch.
    devtools_port: parking_lot::Mutex<Option<u16>>,
    /// Latest screen snapshot, timestamped. Tap/inspect reuse it when fresh
    /// instead of paying an `inspect_screen` round-trip per click.
    latest_screen: std::sync::Mutex<Option<(std::time::Instant, DeviceScreen)>>,
    /// Viewport (CSS px) from the latest screencast frame — the fallback
    /// size when a page exposes no element to measure.
    viewport: parking_lot::Mutex<(u32, u32)>,
}

impl WebDriverKeeper {
    /// Record a screen snapshot.
    pub fn note_screen(&self, screen: &DeviceScreen) {
        *self.latest_screen.lock().unwrap() = Some((std::time::Instant::now(), screen.clone()));
    }

    /// The latest snapshot if it is younger than `max_age`.
    pub fn recent_screen(&self, max_age: Duration) -> Option<DeviceScreen> {
        self.latest_screen
            .lock()
            .unwrap()
            .as_ref()
            .filter(|(at, _)| at.elapsed() < max_age)
            .map(|(_, s)| s.clone())
    }

    /// A screen snapshot for tap/inspect: the cache when fresh, otherwise one
    /// fresh `inspect_screen`.
    pub async fn snapshot(&self, max_age: Duration) -> AppResult<DeviceScreen> {
        if let Some(s) = self.recent_screen(max_age) {
            return Ok(s);
        }
        let s = self.device_screen().await?;
        self.note_screen(&s);
        Ok(s)
    }

    /// Fetch the current hierarchy + viewport + URL.
    pub async fn device_screen(&self) -> AppResult<DeviceScreen> {
        let json = self
            .mcp
            .call_tool(
                "inspect_screen",
                serde_json::json!({ "device_id": WEB_DEVICE_ID }),
                INSPECT_TIMEOUT,
            )
            .await?;
        let (elements, (w, h)) = flatten_inspect_screen(&json)?;
        let (width, height) = if w > 0 && h > 0 {
            (w, h)
        } else {
            *self.viewport.lock()
        };
        let port = *self.devtools_port.lock();
        let url = match port {
            Some(port) => cdp::page_url(port).await,
            None => None,
        };
        Ok(DeviceScreen {
            width,
            height,
            elements,
            url,
        })
    }

    /// Run one maestro command (a single `"<name>: <options>"` line) in the
    /// browser. Invalidates the cached snapshot: the page likely changed.
    pub async fn run_command(&self, command: &str) -> AppResult<()> {
        let yaml = crate::maestro_mcp::inline_flow("web", &[command.to_string()]);
        let result = self
            .mcp
            .call_tool(
                "run",
                serde_json::json!({ "device_id": WEB_DEVICE_ID, "yaml": yaml }),
                COMMAND_TIMEOUT,
            )
            .await;
        *self.latest_screen.lock().unwrap() = None;
        result
            .map(|_| ())
            .map_err(|e| AppError::Other(format!("{e} | sent: {command}")))
    }

    /// Liveness: the keeper process is running and its Chrome still answers
    /// DevTools. Sub-second; a dead browser means the MCP session is stale.
    pub async fn is_alive(&self) -> bool {
        if !self.mcp.is_alive().await {
            return false;
        }
        let port = *self.devtools_port.lock();
        match port {
            Some(port) => cdp::is_reachable(port).await,
            None => false,
        }
    }

    /// `webSocketDebuggerUrl` of the keeper's page, for the screencast.
    async fn page_ws_url(&self) -> Option<String> {
        let port = (*self.devtools_port.lock())?;
        cdp::page_ws_url(port).await
    }

    /// Find the DevTools port of the Chrome launched by *this* keeper — a
    /// descendant of the keeper JVM (`maestro` execs java, so the child pid
    /// is the JVM's). Another headed webdriver Chrome (e.g. a user's own
    /// `maestro mcp`) is never picked.
    async fn discover_devtools_port(&self) -> Option<u16> {
        let root = self.mcp.pid().await?;
        for _ in 0..40 {
            for (_pid, cmd) in
                crate::prockill::descendants_matching(root, WEBDRIVER_CHROME_NEEDLES).await
            {
                if !is_main_browser_process(&cmd) {
                    continue;
                }
                if let Some(port) = cdp::devtools_port(&cmd).await {
                    return Some(port);
                }
            }
            sleep(Duration::from_millis(250)).await;
        }
        None
    }

    #[cfg(test)]
    fn stub_for_tests() -> Self {
        Self {
            mcp: McpClient::stub_for_tests(),
            devtools_port: parking_lot::Mutex::new(None),
            latest_screen: std::sync::Mutex::new(None),
            viewport: parking_lot::Mutex::new((0, 0)),
        }
    }

    pub async fn start(url: Option<&str>, app: Option<&AppHandle>) -> AppResult<Arc<Self>> {
        // Cull any orphan keeper from a crashed prior session. Scoped: only
        // web keepers; a live iOS/Android keeper belonging to this app (or a
        // user's own `maestro mcp`) is never touched.
        crate::prockill::kill_matching(WEB_KEEPER_NEEDLES, "orphan web keeper").await;
        kill_orphan_web_browsers().await;

        emit_status(app, "info", "Starting the web driver…");
        let mcp = McpClient::spawn(&["-p", "web"], &[]).await?;
        let keeper = Arc::new(Self {
            mcp,
            devtools_port: parking_lot::Mutex::new(None),
            latest_screen: std::sync::Mutex::new(None),
            viewport: parking_lot::Mutex::new((0, 0)),
        });

        // The first tool call opens the browser session, launching Chromium.
        // Arm the window hider BEFORE the browser exists: it polls fast and
        // hides the window within a blink of it appearing.
        emit_status(app, "info", "Starting Chromium…");
        spawn_window_hider(app.cloned());
        let slow_hint = {
            let app = app.cloned();
            tokio::spawn(async move {
                sleep(Duration::from_secs(10)).await;
                emit_status(
                    app.as_ref(),
                    "info",
                    "Still starting — first run may download Chromium…",
                );
            })
        };
        let launched = match url {
            Some(u) => {
                let yaml = crate::maestro_mcp::inline_flow("web", &[format!("openLink: {u}")]);
                keeper
                    .mcp
                    .call_tool(
                        "run",
                        serde_json::json!({ "device_id": WEB_DEVICE_ID, "yaml": yaml }),
                        LAUNCH_TIMEOUT,
                    )
                    .await
            }
            None => {
                keeper
                    .mcp
                    .call_tool(
                        "inspect_screen",
                        serde_json::json!({ "device_id": WEB_DEVICE_ID }),
                        LAUNCH_TIMEOUT,
                    )
                    .await
            }
        };
        slow_hint.abort();
        if let Err(e) = launched {
            // A failed `openLink` (bad URL, unreachable site) still leaves a
            // usable browser — only a keeper that died is fatal.
            if !keeper.mcp.is_alive().await || url.is_none() {
                keeper.stop().await;
                return Err(AppError::Other(format!(
                    "the web browser did not start ({e}). Run `maestro -p web test` on a \
                     flow in a terminal to check your maestro + Chrome setup."
                )));
            }
            warn!(error = %e, "web openLink failed (continuing on the current page)");
            emit_status(
                app,
                "warn",
                "Couldn't open the flow's url — the browser stays on its current page.",
            );
        }

        let port = keeper.discover_devtools_port().await;
        if port.is_none() {
            keeper.stop().await;
            return Err(AppError::Other(
                "the web browser started but its DevTools endpoint was not found".into(),
            ));
        }
        *keeper.devtools_port.lock() = port;
        info!(devtools_port = ?port, "web keeper ready");
        emit_status(app, "info", "Web browser ready");
        Ok(keeper)
    }

    pub async fn stop(&self) {
        self.mcp.stop().await;
        // Killing the keeper JVM orphans the chromedriver + Chrome it spawned;
        // reap them so the window closes instead of lingering.
        kill_orphan_web_browsers().await;
    }
}

pub(crate) const WEB_FRAME_EVENT: &str = "web_frame";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFramePayload {
    /// PNG bytes, **base64-encoded** — see `IosFramePayload::data` for why
    /// (raw `Vec<u8>` serializes as a JSON number array and chokes the webview).
    pub data: String,
    pub width: u32,
    pub height: u32,
}

/// Stream the keeper's Chrome over a CDP screencast and emit a `web_frame`
/// per page change until aborted. Also tracks the viewport (for snapshots of
/// element-less pages) and the page URL (so a respawn restores it).
pub fn spawn_screenshot_poller(
    app: AppHandle,
    keeper: Arc<WebDriverKeeper>,
) -> oneshot::Sender<()> {
    let (abort_tx, abort_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let finder_keeper = keeper.clone();
        let find = move || {
            let k = finder_keeper.clone();
            async move { k.page_ws_url().await }
        };
        let mut last_url_check: Option<std::time::Instant> = None;
        cdp::screencast(find, abort_rx, |payload| {
            if payload.width > 0 && payload.height > 0 {
                *keeper.viewport.lock() = (payload.width, payload.height);
            }
            if let Err(e) = app.emit(WEB_FRAME_EVENT, &payload) {
                warn!(error = %e, "failed to emit web_frame");
            }
            // Frames only arrive when the page changes — a cheap moment to
            // refresh the remembered URL (throttled).
            if last_url_check.map_or(true, |t| t.elapsed() > Duration::from_secs(1)) {
                last_url_check = Some(std::time::Instant::now());
                let keeper = keeper.clone();
                let app = app.clone();
                tokio::spawn(async move {
                    let Some(port) = *keeper.devtools_port.lock() else {
                        return;
                    };
                    if let Some(u) = cdp::page_url(port).await.filter(|u| !is_placeholder_url(u)) {
                        use tauri::Manager;
                        *app.state::<crate::state::AppState>().web_last_url.write() = Some(u);
                    }
                });
            }
        })
        .await;
        info!("web screenshot poller aborted");
    });
    abort_tx
}

#[cfg(test)]
mod tests {
    use super::*;

    // Trimmed `inspect_screen` output captured from maestro 2.10.0 on
    // en.wikipedia.org (2026-09-24). maestro reports `platform: ios` for web.
    const INSPECT: &str = r#"{"ui_schema":{"platform":"ios","abbreviations":{"b":"bounds","txt":"text","rid":"resource-id"},"defaults":{"enabled":true}},"elements":[{"b":"[0,0][1200,762]","c":[{"b":"[0,0][1200,66]","c":[{"b":"[44,17][64,49]","rid":"Site","c":[{"b":"[38,17][70,49]","txt":"on","rid":"vector-main-menu-dropdown-checkbox"},{"b":"[44,23][64,43]"},{"b":"[53,108][118,124]","txt":"Main page"},{"b":"[10,10][20,20]","a11y":"Search Wikipedia"}]}]}]}]}"#;

    #[test]
    fn flattens_inspect_screen_into_selector_targets() {
        let (els, viewport) = flatten_inspect_screen(INSPECT).expect("parse");
        assert_eq!(viewport, (1200, 762));
        let els = els.as_array().unwrap();
        // Containers and the bare icon (no text, no id) are dropped.
        assert_eq!(els.len(), 4);
        assert_eq!(els[0]["resourceId"], "Site");
        assert_eq!(
            els[0]["bounds"],
            serde_json::json!({"x":44,"y":17,"width":20,"height":32})
        );
        assert_eq!(els[1]["text"], "on");
        assert_eq!(els[1]["resourceId"], "vector-main-menu-dropdown-checkbox");
        assert_eq!(els[2]["text"], "Main page");
        assert!(els[2].get("resourceId").is_none());
        // Accessibility text doubles as the `text:` selector.
        assert_eq!(els[3]["text"], "Search Wikipedia");
    }

    #[test]
    fn flattened_elements_feed_the_web_hierarchy() {
        let (els, viewport) = flatten_inspect_screen(INSPECT).unwrap();
        let tree = crate::hierarchy::web::parse_device_screen_hierarchy(&els, viewport).unwrap();
        let root = tree.root.unwrap();
        assert_eq!(root.bounds.right, 1200);
        assert_eq!(root.children.len(), 4);
    }

    #[test]
    fn empty_page_has_no_elements_and_no_viewport() {
        let json = r#"{"ui_schema":{},"elements":[]}"#;
        let (els, viewport) = flatten_inspect_screen(json).unwrap();
        assert_eq!(els, serde_json::json!([]));
        assert_eq!(viewport, (0, 0));
        assert!(flatten_inspect_screen("Failed to inspect screen: boom").is_err());
    }

    #[test]
    fn parses_bounds_strings() {
        assert_eq!(parse_bounds("[0,0][1200,762]"), Some((0, 0, 1200, 762)));
        assert_eq!(parse_bounds("[-5,10][20,30]"), Some((-5, 10, 20, 30)));
        assert_eq!(parse_bounds("[1,2]"), None);
        assert_eq!(parse_bounds(""), None);
    }

    #[test]
    fn placeholder_pages_are_never_remembered() {
        // Remembering Chrome's initial page would "restore" the browser to a
        // blank tab on respawn instead of the user's real page.
        assert!(is_placeholder_url("data:,"));
        assert!(is_placeholder_url("about:blank"));
        assert!(!is_placeholder_url("https://www.bouyguestelecom.fr"));
        assert!(!is_placeholder_url("http://127.0.0.1:8080/app"));
    }

    #[test]
    fn window_hider_targets_only_the_main_browser_process() {
        // Real command lines captured 2026-07-10. Only the main process owns
        // the window; helpers carry `--type=` and must not be targeted.
        let main = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --allow-pre-commit-input --enable-automation --test-type=webdriver --user-data-dir=/tmp/x data:,";
        let helper = "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/149.0/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer --enable-automation --test-type=webdriver";
        let personal = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
        assert!(is_main_browser_process(main));
        assert!(!is_main_browser_process(helper));
        assert!(!is_main_browser_process(personal));
    }

    #[test]
    fn recent_screen_respects_freshness_window() {
        let keeper = WebDriverKeeper::stub_for_tests();
        assert!(keeper.recent_screen(Duration::from_secs(2)).is_none());
        let screen = DeviceScreen {
            width: 10,
            height: 10,
            elements: serde_json::json!([]),
            url: Some("https://x".into()),
        };
        keeper.note_screen(&screen);
        // Just stored → fresh.
        assert!(keeper.recent_screen(Duration::from_secs(2)).is_some());
        // Zero-age window → always stale.
        assert!(keeper.recent_screen(Duration::ZERO).is_none());
    }

    #[test]
    fn web_sweep_needles_are_scoped_to_web_keepers() {
        // Regression: a broad sweep once killed the iOS simulator session.
        // The scoped needles must not — nor a user's own `maestro mcp`.
        let ios = "java -classpath /opt/homebrew/Cellar/maestro/2.10.0/libexec/lib/* maestro.cli.AppKt --device ABC mcp --no-viewer";
        let web = "java -classpath /opt/homebrew/Cellar/maestro/2.10.0/libexec/lib/* maestro.cli.AppKt -p web mcp --no-viewer";
        let user = "java -classpath /opt/homebrew/Cellar/maestro/2.10.0/libexec/lib/* maestro.cli.AppKt mcp";
        assert!(crate::prockill::cmdline_matches(web, WEB_KEEPER_NEEDLES));
        assert!(!crate::prockill::cmdline_matches(ios, WEB_KEEPER_NEEDLES));
        assert!(!crate::prockill::cmdline_matches(user, WEB_KEEPER_NEEDLES));
    }

    /// Live end-to-end check against a real `maestro mcp` + Chrome: launch on
    /// a page, read the hierarchy, stream a frame, run a command, tear down.
    ///   MAESTRO_BIN=/path/to/maestro-2.10.0 cargo test --manifest-path \
    ///     src-tauri/Cargo.toml web_keeper_end_to_end -- --ignored --nocapture
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn web_keeper_end_to_end() {
        let t = std::time::Instant::now();
        let keeper = WebDriverKeeper::start(Some("https://en.wikipedia.org/wiki/Main_Page"), None)
            .await
            .expect("start web keeper");
        eprintln!("started in {:?}", t.elapsed());
        assert!(keeper.is_alive().await, "keeper not alive after start");

        let screen = keeper.device_screen().await.expect("device screen");
        eprintln!(
            "screen {}x{}, {} elements, url {:?}",
            screen.width,
            screen.height,
            screen.elements.as_array().map_or(0, Vec::len),
            screen.url
        );
        assert!(screen.width > 0 && screen.height > 0);
        assert!(screen.elements.as_array().is_some_and(|a| !a.is_empty()));
        assert!(screen
            .url
            .as_deref()
            .is_some_and(|u| u.contains("wikipedia")));

        let (abort_tx, abort_rx) = oneshot::channel();
        let (frame_tx, frame_rx) = std::sync::mpsc::channel();
        let k = keeper.clone();
        let cast = tokio::spawn(cdp::screencast(
            move || {
                let k = k.clone();
                async move { k.page_ws_url().await }
            },
            abort_rx,
            move |f| {
                let _ = frame_tx.send((f.width, f.height, f.data.len()));
            },
        ));
        let frame =
            tokio::task::spawn_blocking(move || frame_rx.recv_timeout(Duration::from_secs(10)))
                .await
                .unwrap()
                .expect("no screencast frame");
        eprintln!("frame {frame:?}");
        let _ = abort_tx.send(());
        let _ = cast.await;

        let t = std::time::Instant::now();
        keeper
            .run_command("openLink: https://example.com")
            .await
            .expect("openLink");
        eprintln!("openLink in {:?}", t.elapsed());
        let t = std::time::Instant::now();
        keeper
            .run_command("tapOn: {point: \"50%,50%\"}")
            .await
            .expect("point tap");
        eprintln!("tap in {:?}", t.elapsed());
        let after = keeper.device_screen().await.expect("screen after");
        assert!(after
            .url
            .as_deref()
            .is_some_and(|u| u.contains("example.com")));
        let err = keeper
            .run_command("assertVisible: \"NoSuchElementXYZ\"")
            .await
            .expect_err("missing element must fail");
        eprintln!("expected failure: {err}");

        keeper.stop().await;
        assert!(!keeper.is_alive().await);
        let leftovers = crate::prockill::pids_matching(WEBDRIVER_CHROME_NEEDLES).await;
        assert!(leftovers.is_empty(), "Chrome left behind: {leftovers:?}");
    }

    #[test]
    fn web_run_flag_defaults_off_and_toggles() {
        use std::sync::atomic::Ordering::SeqCst;
        let state = crate::state::AppState::default();
        assert!(!state.web_run_active.load(SeqCst));
        state.web_run_active.store(true, SeqCst);
        assert!(state.web_run_active.load(SeqCst));
        assert_eq!(state.web_respawn_fails.load(SeqCst), 0);
    }
}
