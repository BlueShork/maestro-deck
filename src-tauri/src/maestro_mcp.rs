// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Long-lived `maestro mcp` child speaking JSON-RPC (MCP) over stdio.
//!
//! Maestro 2.6 removed `maestro studio`, which we used to keep a device
//! driver warm (Android gRPC on :7001, iOS XCTest on :22087) and, on web, as
//! the browser's HTTP API. `maestro mcp` is its replacement: it caches one
//! driver session per device for as long as the process lives, so the first
//! tool call targeting a device installs/starts its driver and every later
//! call — or any direct client of that driver — reuses it.
//!
//! The server exits when its stdin closes, so the client holds stdin for its
//! whole life. `--no-viewer` skips the Maestro Viewer HTTP server (it would
//! otherwise grab a local port we never use).
//!
//! Global flags (`--device <id>`, `-p web`) are placed before `mcp`: the
//! server ignores them, but they land in the process command line, which is
//! what lets orphan sweeps target *our* keeper for one device without ever
//! touching a user's own `maestro mcp` (e.g. an AI assistant's).

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex as AsyncMutex};
use tracing::{debug, warn};

use crate::error::{AppError, AppResult};
use crate::process_ext::CommandExtNoWindow;

/// `initialize` is answered once the JVM is up (~2-3 s); a cold machine can
/// be much slower, so be generous.
const INIT_TIMEOUT: Duration = Duration::from_secs(60);

type Pending = Arc<parking_lot::Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

pub struct McpClient {
    child: AsyncMutex<Option<Child>>,
    stdin: AsyncMutex<Option<ChildStdin>>,
    pending: Pending,
    next_id: AtomicU64,
    /// Last stderr lines, to explain an early exit.
    stderr_tail: Arc<parking_lot::Mutex<Vec<String>>>,
}

/// Command-line arguments for `maestro <global_args…> mcp --no-viewer`.
pub fn mcp_args(global_args: &[&str]) -> Vec<String> {
    global_args
        .iter()
        .map(|s| s.to_string())
        .chain(["mcp".to_string(), "--no-viewer".to_string()])
        .collect()
}

/// Text of the first content item of a `tools/call` result, and whether the
/// tool flagged it as an error.
fn tool_result_text(result: &Value) -> (String, bool) {
    let text = result["content"]
        .as_array()
        .and_then(|items| items.iter().find_map(|i| i["text"].as_str()))
        .unwrap_or_default()
        .to_string();
    let is_error = result["isError"].as_bool().unwrap_or(false);
    (text, is_error)
}

/// Route one stdout line to the request waiting for it. Non-JSON lines
/// (kotlin-logging prints a banner on stdout) and notifications are ignored.
fn route_line(line: &str, pending: &Pending) {
    let Ok(msg) = serde_json::from_str::<Value>(line) else {
        return;
    };
    let Some(id) = msg["id"].as_u64() else {
        return;
    };
    let Some(tx) = pending.lock().remove(&id) else {
        return;
    };
    let outcome = if let Some(err) = msg.get("error") {
        Err(err["message"]
            .as_str()
            .unwrap_or("unknown MCP error")
            .to_string())
    } else {
        Ok(msg["result"].clone())
    };
    let _ = tx.send(outcome);
}

impl McpClient {
    /// Spawn `maestro <global_args…> mcp --no-viewer` and complete the MCP
    /// handshake. No device is touched until the first tool call.
    pub async fn spawn(global_args: &[&str], envs: &[(&str, &str)]) -> AppResult<Self> {
        let bin = crate::tool_paths::maestro_bin();
        let mut cmd = Command::new(&bin);
        cmd.no_window()
            .args(mcp_args(global_args))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for (k, v) in envs {
            cmd.env(k, v);
        }
        let mut child = cmd.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::RunnerNotFound
            } else {
                AppError::Io(e)
            }
        })?;

        let pending: Pending = Arc::default();
        let stderr_tail: Arc<parking_lot::Mutex<Vec<String>>> = Arc::default();

        if let Some(out) = child.stdout.take() {
            let pending = pending.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(out).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    route_line(&line, &pending);
                }
                // EOF: the server is gone — fail every in-flight request.
                for (_, tx) in pending.lock().drain() {
                    let _ = tx.send(Err("maestro mcp exited".into()));
                }
            });
        }
        if let Some(err) = child.stderr.take() {
            let tail = stderr_tail.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(err).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    debug!(target: "maestro_mcp", "{line}");
                    let mut t = tail.lock();
                    t.push(line);
                    if t.len() > 20 {
                        t.remove(0);
                    }
                }
            });
        }

        let client = Self {
            stdin: AsyncMutex::new(child.stdin.take()),
            child: AsyncMutex::new(Some(child)),
            pending,
            next_id: AtomicU64::new(1),
            stderr_tail,
        };

        client
            .request(
                "initialize",
                json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": { "name": "maestro-deck", "version": env!("CARGO_PKG_VERSION") },
                }),
                INIT_TIMEOUT,
            )
            .await?;
        client
            .send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
            .await?;
        Ok(client)
    }

    async fn send(&self, msg: &Value) -> AppResult<()> {
        let mut line = msg.to_string();
        line.push('\n');
        let mut guard = self.stdin.lock().await;
        let stdin = guard
            .as_mut()
            .ok_or_else(|| AppError::RunnerFailed("maestro mcp is stopped".into()))?;
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| AppError::RunnerFailed(format!("maestro mcp stdin: {e}")))?;
        stdin
            .flush()
            .await
            .map_err(|e| AppError::RunnerFailed(format!("maestro mcp stdin: {e}")))
    }

    async fn request(&self, method: &str, params: Value, timeout: Duration) -> AppResult<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(id, tx);
        let sent = self
            .send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await;
        if let Err(e) = sent {
            self.pending.lock().remove(&id);
            return Err(e);
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(Ok(v))) => Ok(v),
            Ok(Ok(Err(msg))) => Err(AppError::RunnerFailed(self.explain(&msg))),
            Ok(Err(_)) => Err(AppError::RunnerFailed(self.explain("maestro mcp exited"))),
            Err(_) => {
                self.pending.lock().remove(&id);
                Err(AppError::RunnerFailed(format!(
                    "maestro mcp: `{method}` timed out after {timeout:?}"
                )))
            }
        }
    }

    /// Append the tail of stderr to a failure message — the only clue when
    /// the JVM dies on startup (bad Java, broken install…).
    fn explain(&self, msg: &str) -> String {
        let tail = self.stderr_tail.lock();
        let last = tail
            .iter()
            .rev()
            .find(|l| !l.trim().is_empty())
            .map(|l| l.trim().to_string());
        match last {
            Some(l) if msg.contains("exited") => format!("{msg}: {l}"),
            _ => msg.to_string(),
        }
    }

    /// Call an MCP tool and return its text output. A tool-level failure
    /// (`isError: true`) becomes `RunnerFailed` carrying the tool's message.
    pub async fn call_tool(&self, name: &str, args: Value, timeout: Duration) -> AppResult<String> {
        let result = self
            .request(
                "tools/call",
                json!({ "name": name, "arguments": args }),
                timeout,
            )
            .await?;
        let (text, is_error) = tool_result_text(&result);
        if is_error {
            return Err(AppError::RunnerFailed(text));
        }
        Ok(text)
    }

    /// True while the `maestro mcp` process is running.
    pub async fn is_alive(&self) -> bool {
        match self.child.lock().await.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        }
    }

    /// Exit status if the process has already exited.
    pub async fn exit_status(&self) -> Option<std::process::ExitStatus> {
        self.child
            .lock()
            .await
            .as_mut()
            .and_then(|c| c.try_wait().ok().flatten())
    }

    /// Kill the process. Idempotent. The device-side driver is left as-is
    /// (a SIGKILLed server never runs its session teardown).
    pub async fn stop(&self) {
        self.stdin.lock().await.take();
        if let Some(mut child) = self.child.lock().await.take() {
            if let Err(e) = child.kill().await {
                warn!(error = %e, "maestro mcp kill failed");
            }
            let _ = child.wait().await;
        }
    }

    /// A client with no process behind it (every call fails).
    #[cfg(test)]
    pub fn stub_for_tests() -> Self {
        Self {
            child: AsyncMutex::new(None),
            stdin: AsyncMutex::new(None),
            pending: Arc::default(),
            next_id: AtomicU64::new(1),
            stderr_tail: Arc::default(),
        }
    }

    /// PID of the running process, if any.
    pub async fn pid(&self) -> Option<u32> {
        self.child.lock().await.as_ref().and_then(|c| c.id())
    }
}

/// Wrap bare commands into the inline flow `run` expects: MCP rejects YAML
/// without a config section ("Config Section Required"). The `appId` value
/// is irrelevant for web and for commands that don't target an app.
pub fn inline_flow(app_id: &str, commands: &[String]) -> String {
    let mut yaml = format!("appId: {app_id}\n---\n");
    for c in commands {
        yaml.push_str("- ");
        yaml.push_str(c);
        yaml.push('\n');
    }
    yaml
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_mcp_args_with_global_flags_first() {
        assert_eq!(
            mcp_args(&["--device", "ABC"]),
            vec!["--device", "ABC", "mcp", "--no-viewer"]
        );
        assert_eq!(mcp_args(&[]), vec!["mcp", "--no-viewer"]);
    }

    #[test]
    fn extracts_tool_text_and_error_flag() {
        // Shapes captured from maestro 2.10.0 `maestro mcp`.
        let ok = json!({"content":[{"text":"{\"success\":true}","type":"text"}],"isError":false});
        assert_eq!(tool_result_text(&ok), ("{\"success\":true}".into(), false));
        let err = json!({"content":[{"text":"Failed to run flow: Element not found","type":"text"}],"isError":true});
        assert_eq!(
            tool_result_text(&err),
            ("Failed to run flow: Element not found".into(), true)
        );
        assert_eq!(tool_result_text(&json!({})), (String::new(), false));
    }

    #[test]
    fn routes_responses_by_id_and_ignores_noise() {
        let pending: Pending = Arc::default();
        let (tx, mut rx) = oneshot::channel();
        pending.lock().insert(7, tx);
        route_line("kotlin-logging: initializing...", &pending);
        route_line(r#"{"jsonrpc":"2.0","method":"notifications/x"}"#, &pending);
        route_line(r#"{"jsonrpc":"2.0","id":99,"result":{}}"#, &pending);
        assert!(
            rx.try_recv().is_err(),
            "unrelated lines must not resolve id 7"
        );
        route_line(r#"{"jsonrpc":"2.0","id":7,"result":{"ok":1}}"#, &pending);
        assert_eq!(rx.try_recv().unwrap().unwrap(), json!({"ok":1}));
    }

    #[test]
    fn routes_jsonrpc_errors() {
        let pending: Pending = Arc::default();
        let (tx, mut rx) = oneshot::channel();
        pending.lock().insert(3, tx);
        route_line(
            r#"{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"no such method"}}"#,
            &pending,
        );
        assert_eq!(rx.try_recv().unwrap().unwrap_err(), "no such method");
    }

    #[test]
    fn wraps_commands_in_inline_flow() {
        assert_eq!(
            inline_flow("web", &["tapOn: \"OK\"".into(), "inputText: hi".into()]),
            "appId: web\n---\n- tapOn: \"OK\"\n- inputText: hi\n"
        );
    }
}
