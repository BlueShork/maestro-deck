// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Chrome DevTools Protocol plumbing shared by the web session preview and
//! the run mirror. Maestro drives Chrome through Selenium, and Chrome always
//! writes its DevTools endpoint to `<user-data-dir>/DevToolsActivePort`, so
//! we can attach a `Page.startScreencast` to any maestro-driven browser
//! without owning it.

use std::future::Future;
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use tokio::sync::oneshot;
use tokio::time::sleep;
use tokio_tungstenite::tungstenite::Message;
use tracing::info;

use super::WebFramePayload;

/// `--user-data-dir=<path>` from a Chrome command line.
pub(super) fn user_data_dir(cmdline: &str) -> Option<&str> {
    let start = cmdline.find("--user-data-dir=")? + "--user-data-dir=".len();
    cmdline[start..].split_whitespace().next()
}

/// DevTools HTTP port of the Chrome with this command line, once its
/// `DevToolsActivePort` file exists (Chrome writes it shortly after spawn).
pub(super) async fn devtools_port(cmdline: &str) -> Option<u16> {
    let dir = user_data_dir(cmdline)?;
    let s = tokio::fs::read_to_string(format!("{dir}/DevToolsActivePort"))
        .await
        .ok()?;
    s.lines().next().and_then(|l| l.trim().parse().ok())
}

fn http_client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(1))
        .timeout(Duration::from_secs(3))
        .build()
        .ok()
}

/// The first `page` target of a DevTools endpoint.
async fn first_page(port: u16) -> Option<serde_json::Value> {
    let targets: serde_json::Value = http_client()?
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
        .cloned()
}

/// `webSocketDebuggerUrl` of the first `page` target on a DevTools endpoint.
pub(super) async fn page_ws_url(port: u16) -> Option<String> {
    first_page(port)
        .await
        .and_then(|t| t["webSocketDebuggerUrl"].as_str().map(str::to_string))
}

/// URL currently loaded in the first `page` target.
pub(super) async fn page_url(port: u16) -> Option<String> {
    first_page(port)
        .await
        .and_then(|t| t["url"].as_str().map(str::to_string))
}

/// True while the DevTools endpoint answers — i.e. the browser is up.
pub(super) async fn is_reachable(port: u16) -> bool {
    let Some(client) = http_client() else {
        return false;
    };
    client
        .get(format!("http://127.0.0.1:{port}/json/version"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Attach a CDP screencast to the page found by `find_ws` and hand each frame
/// to `on_frame` until aborted. CDP pushes a frame only when the page actually
/// changes, and `data` is already base64 (zero re-encode). The target is
/// re-discovered whenever the socket drops (tab navigated to a fresh target,
/// browser restarted…). Returns when `abort_rx` fires.
pub(super) async fn screencast<F, Fut>(
    mut find_ws: F,
    mut abort_rx: oneshot::Receiver<()>,
    mut on_frame: impl FnMut(WebFramePayload),
) where
    F: FnMut() -> Fut,
    Fut: Future<Output = Option<String>>,
{
    'attach: loop {
        // The browser may take a few seconds to appear — poll until it does
        // or we're aborted.
        let ws_url = loop {
            if let Some(u) = find_ws().await {
                break u;
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
        info!(%ws_url, "CDP screencast attached");
        // JPEG q75: ~10× smaller than PNG per frame (and much faster for
        // Chrome to encode) — the difference between a slideshow and a
        // real-time feel. The frontend sniffs the 0xFFD8 magic and types
        // the blob accordingly.
        let _ = ws
            .send(Message::Text(
                r#"{"id":1,"method":"Page.startScreencast","params":{"format":"jpeg","quality":75,"everyNthFrame":1,"maxWidth":1600,"maxHeight":1600}}"#.into(),
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
                    let Some((payload, sid)) = parse_frame(&txt) else {
                        continue;
                    };
                    on_frame(payload);
                    let ack = format!(
                        r#"{{"id":2,"method":"Page.screencastFrameAck","params":{{"sessionId":{sid}}}}}"#
                    );
                    let _ = ws.send(Message::Text(ack)).await;
                }
                Some(Ok(_)) => {}
                Some(Err(_)) | None => {
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
}

/// A `Page.screencastFrame` event → frame payload + session id to ack.
fn parse_frame(txt: &str) -> Option<(WebFramePayload, i64)> {
    let v: serde_json::Value = serde_json::from_str(txt).ok()?;
    if v["method"] != "Page.screencastFrame" {
        return None;
    }
    let p = &v["params"];
    let data = p["data"].as_str()?;
    let sid = p["sessionId"].as_i64()?;
    Some((
        WebFramePayload {
            data: data.to_string(),
            // CSS pixels — the coordinate space of the element bounds.
            width: p["metadata"]["deviceWidth"].as_u64().unwrap_or(0) as u32,
            height: p["metadata"]["deviceHeight"].as_u64().unwrap_or(0) as u32,
        },
        sid,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_user_data_dir() {
        let run = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --allow-pre-commit-input --enable-automation --headless=new --test-type=webdriver --user-data-dir=/var/folders/kc/T/org.chromium.Chromium.scoped_dir.t1KHli data:,";
        assert_eq!(
            user_data_dir(run),
            Some("/var/folders/kc/T/org.chromium.Chromium.scoped_dir.t1KHli")
        );
        assert_eq!(user_data_dir("chrome --no-user-data"), None);
    }

    #[test]
    fn parses_screencast_frames_only() {
        let frame = r#"{"method":"Page.screencastFrame","params":{"data":"/9j/AA==","sessionId":4,"metadata":{"deviceWidth":1200,"deviceHeight":762}}}"#;
        let (p, sid) = parse_frame(frame).expect("frame");
        assert_eq!(sid, 4);
        assert_eq!(p.data, "/9j/AA==");
        assert_eq!((p.width, p.height), (1200, 762));
        assert!(parse_frame(r#"{"id":1,"result":{}}"#).is_none());
        assert!(parse_frame("not json").is_none());
    }
}
