// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Live view of a headless `maestro -p web test` run. The run's Chrome is a
//! separate headless instance we don't spawn, but Chrome always writes its
//! DevTools endpoint to `<user-data-dir>/DevToolsActivePort`. We attach a CDP
//! `Page.startScreencast` over WebSocket and re-emit each frame as the
//! regular `web_frame` event — the canvas shows the test executing live.
//! Best-effort: if the mirror can't attach, the run itself is unaffected.

use std::time::Duration;

use futures::{SinkExt, StreamExt};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use tokio::time::sleep;
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};

use super::{WebFramePayload, WEB_FRAME_EVENT};

/// Marker of the run's Chrome: webdriver-driven, main process, AND headless —
/// the studio session's hidden browser is headed, so this never matches it.
fn is_headless_run_chrome(cmdline: &str) -> bool {
    super::is_main_browser_process(cmdline) && cmdline.contains("--headless")
}

/// `--user-data-dir=<path>` from a Chrome command line.
fn user_data_dir(cmdline: &str) -> Option<&str> {
    let start = cmdline.find("--user-data-dir=")? + "--user-data-dir=".len();
    cmdline[start..].split_whitespace().next()
}

/// DevTools HTTP port of the run's Chrome, once both the process and its
/// `DevToolsActivePort` file exist (Chrome writes it shortly after spawn).
async fn find_devtools_port() -> Option<u16> {
    for (_pid, cmd) in crate::prockill::pids_matching(&["test-type=webdriver"]).await {
        if !is_headless_run_chrome(&cmd) {
            continue;
        }
        let Some(dir) = user_data_dir(&cmd) else {
            continue;
        };
        if let Ok(s) = tokio::fs::read_to_string(format!("{dir}/DevToolsActivePort")).await {
            if let Some(port) = s.lines().next().and_then(|l| l.trim().parse().ok()) {
                return Some(port);
            }
        }
    }
    None
}

/// `webSocketDebuggerUrl` of the first `page` target on a DevTools endpoint.
async fn page_ws_url(port: u16) -> Option<String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(1))
        .timeout(Duration::from_secs(3))
        .build()
        .ok()?;
    let targets: serde_json::Value = client
        .get(format!("http://127.0.0.1:{port}/json/list"))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    targets
        .as_array()?
        .iter()
        .find(|t| t["type"] == "page")
        .and_then(|t| t["webSocketDebuggerUrl"].as_str().map(str::to_string))
}

/// Attach to the run's Chrome and re-emit screencast frames until aborted.
/// CDP pushes a frame only when the page actually changes — ideal cadence
/// for a live test view, and `data` is already base64 PNG (zero re-encode).
pub fn spawn_run_mirror(app: AppHandle) -> oneshot::Sender<()> {
    let (abort_tx, mut abort_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        'attach: loop {
            // The run's Chrome takes a few seconds to appear (maestro boots
            // chromedriver first) — poll until it does or we're aborted.
            let ws_url = loop {
                if let Some(port) = find_devtools_port().await {
                    if let Some(u) = page_ws_url(port).await {
                        break u;
                    }
                }
                tokio::select! {
                    biased;
                    _ = &mut abort_rx => return,
                    _ = sleep(Duration::from_millis(300)) => {}
                }
            };
            let Ok((mut ws, _)) = tokio_tungstenite::connect_async(&ws_url).await else {
                tokio::select! {
                    biased;
                    _ = &mut abort_rx => return,
                    _ = sleep(Duration::from_millis(500)) => {}
                }
                continue 'attach;
            };
            info!(%ws_url, "run mirror attached (CDP screencast)");
            let _ = ws
                .send(Message::Text(
                    r#"{"id":1,"method":"Page.startScreencast","params":{"format":"png","everyNthFrame":1,"maxWidth":1600,"maxHeight":1600}}"#.into(),
                ))
                .await;
            loop {
                let msg = tokio::select! {
                    biased;
                    _ = &mut abort_rx => return,
                    m = ws.next() => m,
                };
                match msg {
                    Some(Ok(Message::Text(txt))) => {
                        let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) else {
                            continue;
                        };
                        if v["method"] != "Page.screencastFrame" {
                            continue;
                        }
                        let p = &v["params"];
                        let (Some(data), Some(sid)) = (p["data"].as_str(), p["sessionId"].as_i64())
                        else {
                            continue;
                        };
                        let payload = WebFramePayload {
                            // CDP delivers base64 PNG — pass through untouched.
                            data: data.to_string(),
                            width: p["metadata"]["deviceWidth"].as_u64().unwrap_or(0) as u32,
                            height: p["metadata"]["deviceHeight"].as_u64().unwrap_or(0) as u32,
                        };
                        if let Err(e) = app.emit(WEB_FRAME_EVENT, &payload) {
                            warn!(error = %e, "failed to emit run-mirror frame");
                        }
                        let ack = format!(
                            r#"{{"id":2,"method":"Page.screencastFrameAck","params":{{"sessionId":{sid}}}}}"#
                        );
                        let _ = ws.send(Message::Text(ack)).await;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) | None => {
                        // Tab closed or navigated to a fresh target, or the
                        // run ended — try to re-attach until aborted.
                        tokio::select! {
                            biased;
                            _ = &mut abort_rx => return,
                            _ = sleep(Duration::from_millis(300)) => {}
                        }
                        continue 'attach;
                    }
                }
            }
        }
    });
    abort_tx
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real command line captured 2026-07-10 from a `maestro -p web test
    // --headless` run.
    const RUN_CHROME: &str = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --allow-pre-commit-input --enable-automation --headless=new --test-type=webdriver --user-data-dir=/var/folders/kc/T/org.chromium.Chromium.scoped_dir.t1KHli data:,";
    const STUDIO_CHROME: &str = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --enable-automation --test-type=webdriver --user-data-dir=/tmp/x data:,";

    #[test]
    fn run_chrome_matcher_requires_headless() {
        // The studio's hidden (but headed) browser must never be mirrored.
        assert!(is_headless_run_chrome(RUN_CHROME));
        assert!(!is_headless_run_chrome(STUDIO_CHROME));
    }

    #[test]
    fn extracts_user_data_dir() {
        assert_eq!(
            user_data_dir(RUN_CHROME),
            Some("/var/folders/kc/T/org.chromium.Chromium.scoped_dir.t1KHli")
        );
        assert_eq!(user_data_dir("chrome --no-user-data"), None);
    }
}
