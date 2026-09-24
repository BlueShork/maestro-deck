// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Live view of a headless `maestro -p web test` run. The run's Chrome is a
//! separate headless instance we don't spawn, but Chrome always writes its
//! DevTools endpoint to `<user-data-dir>/DevToolsActivePort`. We attach a CDP
//! `Page.startScreencast` over WebSocket and re-emit each frame as the
//! regular `web_frame` event — the canvas shows the test executing live.
//! Best-effort: if the mirror can't attach, the run itself is unaffected.

use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use tracing::{info, warn};

use super::{cdp, WEB_FRAME_EVENT};

/// Marker of the run's Chrome: webdriver-driven, main process, AND headless —
/// the session keeper's hidden browser is headed, so this never matches it.
fn is_headless_run_chrome(cmdline: &str) -> bool {
    super::is_main_browser_process(cmdline) && cmdline.contains("--headless")
}

/// DevTools HTTP port of the run's Chrome, once both the process and its
/// `DevToolsActivePort` file exist (Chrome writes it shortly after spawn).
async fn find_devtools_port() -> Option<u16> {
    for (_pid, cmd) in crate::prockill::pids_matching(&["test-type=webdriver"]).await {
        if !is_headless_run_chrome(&cmd) {
            continue;
        }
        if let Some(port) = cdp::devtools_port(&cmd).await {
            return Some(port);
        }
    }
    None
}

/// Kill headless run Chromes left over from a PREVIOUS run. maestro doesn't
/// always reap its browser on exit, and a lingering one would win the
/// mirror's discovery race: the canvas would show the last run's final frame
/// instead of the new run executing. The web keeper's browser is headed, so it
/// never matches; a stale chromedriver (browserless) is harmless and gets
/// swept at the next keeper start.
pub async fn kill_stale_run_chromes() {
    for (pid, cmd) in crate::prockill::pids_matching(&["test-type=webdriver"]).await {
        if is_headless_run_chrome(&cmd) {
            warn!(
                pid,
                "killing stale headless run Chrome (previous run leftover)"
            );
            crate::prockill::kill_pid(pid).await;
        }
    }
}

/// Attach to the run's Chrome and re-emit screencast frames until aborted.
pub fn spawn_run_mirror(app: AppHandle) -> oneshot::Sender<()> {
    let (abort_tx, abort_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        // The run's Chrome takes a few seconds to appear (maestro boots
        // chromedriver first) — `screencast` polls until it does.
        let find = || async {
            let port = find_devtools_port().await?;
            cdp::page_ws_url(port).await
        };
        cdp::screencast(find, abort_rx, |payload| {
            if let Err(e) = app.emit(WEB_FRAME_EVENT, &payload) {
                warn!(error = %e, "failed to emit run-mirror frame");
            }
        })
        .await;
        info!("run mirror stopped");
    });
    abort_tx
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real command line captured 2026-07-10 from a `maestro -p web test
    // --headless` run.
    const RUN_CHROME: &str = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --allow-pre-commit-input --enable-automation --headless=new --test-type=webdriver --user-data-dir=/var/folders/kc/T/org.chromium.Chromium.scoped_dir.t1KHli data:,";
    const SESSION_CHROME: &str = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --enable-automation --test-type=webdriver --user-data-dir=/tmp/x data:,";

    #[test]
    fn run_chrome_matcher_requires_headless() {
        // The session keeper's hidden (but headed) browser must never be mirrored.
        assert!(is_headless_run_chrome(RUN_CHROME));
        assert!(!is_headless_run_chrome(SESSION_CHROME));
    }
}
