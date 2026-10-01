// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! One farm session: a WebSocket to the gateway carrying video, input,
//! inspect, runs and files for a phone in the device farm.

use std::collections::{BTreeMap, HashMap};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncWriteExt, DuplexStream};
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex, Notify};
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};

use crate::error::{AppError, AppResult};
use crate::farm::bundle::FlowBundle;
use crate::farm::frames::*;
use crate::scrcpy::stream::{run_reader_session, FramePayload, FrameSink};

const HELLO_TIMEOUT: Duration = Duration::from_secs(60);
const INSPECT_TIMEOUT: Duration = Duration::from_secs(30);
const APK_TIMEOUT: Duration = Duration::from_secs(600);
const MAX_APK_BYTES: u64 = 300 * 1024 * 1024;
const VIDEO_PIPE_BYTES: usize = 4 * 1024 * 1024;
const CONTROL_DEPTH: usize = 256;

/// What the session reports to the rest of the app (Tauri events in production).
pub trait FarmEvents: Send + Sync + 'static {
    fn session(&self, event: SessionEvent);
    fn run_line(&self, pid: u32, line: &str);
    fn run_exit(&self, pid: u32, code: Option<i32>);
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionEvent {
    Hello { hello: Hello },
    IdleWarning { closes_at: f64 },
    MinutesWarning { closes_at: f64, reason: String },
    Reconnecting,
    Reconnected,
    Closing { reason: String },
    Error { code: String, message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Screen {
    pub width: u32,
    pub height: u32,
    pub density: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub device_id: String,
    pub model: Option<String>,
    pub android_release: Option<String>,
    pub screen: Option<Screen>,
    pub video_width: Option<u32>,
    pub video_height: Option<u32>,
    pub minutes_remaining: f64,
    pub max_ends_at: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ApkResult {
    pub ok: bool,
    pub packages: Vec<String>,
    pub message: String,
}

/// A `FrameSink` that can be cloned for each new video pipeline.
#[derive(Clone)]
pub struct SharedSink(Arc<dyn Fn(FramePayload) + Send + Sync>);

impl SharedSink {
    pub fn new(f: impl Fn(FramePayload) + Send + Sync + 'static) -> Self {
        Self(Arc::new(f))
    }
}

impl FrameSink for SharedSink {
    fn emit(&self, payload: FramePayload) {
        (self.0)(payload)
    }
}

struct RunState {
    pid: u32,
    run_id: String,
    flow_dir: PathBuf,
    capture: Option<(String, Vec<u8>)>,
}

pub struct FarmSession {
    out_tx: mpsc::UnboundedSender<Vec<u8>>,
    /// Held by the writer of the current connection; survives reconnects.
    out_rx: Arc<AsyncMutex<mpsc::UnboundedReceiver<Vec<u8>>>>,
    control_tx: mpsc::Sender<Vec<u8>>,
    events: Arc<dyn FarmEvents>,
    sink: SharedSink,
    pending_inspect: Mutex<HashMap<u64, oneshot::Sender<Result<String, String>>>>,
    next_id: AtomicU64,
    run: Mutex<Option<RunState>>,
    apk_waiter: Mutex<Option<oneshot::Sender<ApkResult>>>,
    video: AsyncMutex<Option<(DuplexStream, oneshot::Sender<()>)>>,
    hello: Mutex<Option<Hello>>,
    hello_notify: Notify,
    close_reason: Mutex<Option<String>>,
    closed: AtomicBool,
    generation: AtomicU64,
    /// Frames queued / written to the socket: lets `release` wait for its frame.
    queued: AtomicU64,
    sent: Arc<AtomicU64>,
}

impl std::fmt::Debug for FarmSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FarmSession")
            .field("hello", &*self.hello.lock())
            .field("closed", &self.closed.load(Ordering::SeqCst))
            .finish()
    }
}

impl FarmSession {
    pub async fn connect(
        url: &str,
        token: &str,
        events: Arc<dyn FarmEvents>,
        sink: SharedSink,
    ) -> AppResult<Arc<Self>> {
        let (out_tx, out_rx) = mpsc::unbounded_channel();
        let (control_tx, mut control_rx) = mpsc::channel::<Vec<u8>>(CONTROL_DEPTH);
        let session = Arc::new(Self {
            out_tx: out_tx.clone(),
            out_rx: Arc::new(AsyncMutex::new(out_rx)),
            control_tx,
            events,
            sink,
            pending_inspect: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            run: Mutex::new(None),
            apk_waiter: Mutex::new(None),
            video: AsyncMutex::new(None),
            hello: Mutex::new(None),
            hello_notify: Notify::new(),
            close_reason: Mutex::new(None),
            closed: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            queued: AtomicU64::new(0),
            sent: Arc::new(AtomicU64::new(0)),
        });
        // The app's input code writes scrcpy control messages to this channel,
        // exactly as for a local device; they leave on channel 2.
        tokio::spawn(async move {
            while let Some(msg) = control_rx.recv().await {
                if out_tx.send(frame(CH_INPUT, &msg)).is_err() {
                    break;
                }
            }
        });
        session.clone().attach(url, token).await?;
        match tokio::time::timeout(HELLO_TIMEOUT, session.wait_hello()).await {
            Ok(Ok(_)) => Ok(session),
            Ok(Err(e)) => Err(e),
            Err(_) => {
                session.release().await;
                Err(AppError::Other(
                    "the farm phone did not start in time".into(),
                ))
            }
        }
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// Every queued frame has been written to the socket.
    pub fn flushed(&self) -> bool {
        self.sent.load(Ordering::SeqCst) >= self.queued.load(Ordering::SeqCst)
    }

    pub fn hello(&self) -> Option<Hello> {
        self.hello.lock().clone()
    }

    pub fn control_sender(&self) -> mpsc::Sender<Vec<u8>> {
        self.control_tx.clone()
    }

    async fn wait_hello(&self) -> AppResult<Hello> {
        loop {
            let notified = self.hello_notify.notified();
            if let Some(h) = self.hello() {
                return Ok(h);
            }
            if self.closed.load(Ordering::SeqCst) {
                let reason = self
                    .close_reason
                    .lock()
                    .clone()
                    .unwrap_or_else(|| "closed".into());
                return Err(AppError::Other(format!(
                    "the farm session ended ({reason})"
                )));
            }
            notified.await;
        }
    }

    async fn attach(self: Arc<Self>, url: &str, token: &str) -> AppResult<()> {
        let target = format!("{}/session?token={}", url.trim_end_matches('/'), token);
        let (ws, _) = tokio_tungstenite::connect_async(target)
            .await
            .map_err(|e| AppError::Other(format!("farm gateway unreachable: {e}")))?;
        let (mut write, mut read) = ws.split();
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let (stop_tx, mut stop_rx) = oneshot::channel::<()>();

        let out_rx = self.out_rx.clone();
        let sent = self.sent.clone();
        tokio::spawn(async move {
            // Waits for the previous connection's writer to let go of the queue.
            let mut rx = out_rx.lock().await;
            loop {
                tokio::select! {
                    _ = &mut stop_rx => break,
                    msg = rx.recv() => match msg {
                        Some(m) => {
                            if write.send(Message::Binary(m)).await.is_err() {
                                break;
                            }
                            sent.fetch_add(1, Ordering::SeqCst);
                        }
                        None => break,
                    },
                }
            }
            let _ = write.close().await;
        });

        let me = self.clone();
        tokio::spawn(async move {
            let mut close_code: Option<u16> = None;
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(Message::Binary(data)) => me.dispatch(&data).await,
                    Ok(Message::Close(frame)) => {
                        close_code = frame.map(|f| u16::from(f.code));
                        break;
                    }
                    Ok(_) => {}
                    Err(e) => {
                        warn!(error = %e, "farm link error");
                        break;
                    }
                }
            }
            let _ = stop_tx.send(());
            me.on_disconnect(generation, close_code).await;
        });
        Ok(())
    }

    pub async fn reconnect(self: &Arc<Self>, url: &str, token: &str) -> AppResult<()> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(AppError::Other("the farm session has ended".into()));
        }
        self.clone().attach(url, token).await?;
        self.events.session(SessionEvent::Reconnected);
        Ok(())
    }

    async fn on_disconnect(&self, generation: u64, close_code: Option<u16>) {
        if self.generation.load(Ordering::SeqCst) != generation {
            return; // an older connection; a newer one is already attached
        }
        if let Some((_, abort)) = self.video.lock().await.take() {
            let _ = abort.send(());
        }
        if self.closed.load(Ordering::SeqCst) {
            return;
        }
        // The gateway refused or forgot the session: no point reconnecting.
        if matches!(close_code, Some(4401 | 4403 | 4404 | 4409)) {
            self.mark_closed("disconnected");
            return;
        }
        info!(?close_code, "farm link lost, waiting for a reconnect token");
        self.events.session(SessionEvent::Reconnecting);
    }

    fn mark_closed(&self, reason: &str) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        *self.close_reason.lock() = Some(reason.to_string());
        for (_, tx) in self.pending_inspect.lock().drain() {
            let _ = tx.send(Err(format!("session closed ({reason})")));
        }
        if let Some(run) = self.run.lock().take() {
            self.events
                .run_line(run.pid, &format!("[farm] session closed ({reason})"));
            self.events.run_exit(run.pid, None);
        }
        self.apk_waiter.lock().take();
        self.hello_notify.notify_waiters();
        self.events.session(SessionEvent::Closing {
            reason: reason.to_string(),
        });
    }

    async fn dispatch(&self, data: &[u8]) {
        let Some((channel, payload)) = split(data) else {
            return;
        };
        match channel {
            CH_CONTROL => self.on_control(payload),
            CH_VIDEO => self.on_video(payload).await,
            CH_INSPECT => self.on_inspect(payload),
            CH_RUN => self.on_run(payload),
            CH_FILES => self.on_files(payload),
            _ => {}
        }
    }

    fn on_control(&self, payload: &[u8]) {
        let Ok(v) = serde_json::from_slice::<Value>(payload) else {
            return;
        };
        match v["type"].as_str() {
            Some("hello") => {
                if let Ok(h) = serde_json::from_value::<Hello>(v.clone()) {
                    *self.hello.lock() = Some(h.clone());
                    self.hello_notify.notify_waiters();
                    self.events.session(SessionEvent::Hello { hello: h });
                }
            }
            Some("idle_warning") => self.events.session(SessionEvent::IdleWarning {
                closes_at: v["closesAt"].as_f64().unwrap_or_default(),
            }),
            Some("minutes_warning") => self.events.session(SessionEvent::MinutesWarning {
                closes_at: v["closesAt"].as_f64().unwrap_or_default(),
                reason: v["reason"].as_str().unwrap_or_default().to_string(),
            }),
            Some("closing") => self.mark_closed(v["reason"].as_str().unwrap_or("closed")),
            Some("error") => self.events.session(SessionEvent::Error {
                code: v["code"].as_str().unwrap_or_default().to_string(),
                message: v["message"].as_str().unwrap_or_default().to_string(),
            }),
            _ => {}
        }
    }

    async fn on_video(&self, payload: &[u8]) {
        let mut video = self.video.lock().await;
        if payload.len() == STREAM_HEADER_BYTES {
            // A new header (first one, or after a reconnect): new pipeline.
            if let Some((_, abort)) = video.take() {
                let _ = abort.send(());
            }
            let (mut writer, reader) = tokio::io::duplex(VIDEO_PIPE_BYTES);
            if writer.write_all(payload).await.is_err() {
                return;
            }
            let (abort_tx, abort_rx) = oneshot::channel();
            let sink = self.sink.clone();
            tokio::spawn(async move {
                if let Err(e) = run_reader_session(reader, sink, abort_rx).await {
                    warn!(error = %e, "farm video loop ended");
                }
            });
            *video = Some((writer, abort_tx));
            return;
        }
        if let Some((writer, _)) = video.as_mut() {
            if writer.write_all(payload).await.is_err() {
                *video = None;
            }
        }
    }

    fn on_inspect(&self, payload: &[u8]) {
        let Ok(v) = serde_json::from_slice::<Value>(payload) else {
            return;
        };
        let Some(id) = v["id"].as_u64() else { return };
        let Some(tx) = self.pending_inspect.lock().remove(&id) else {
            return;
        };
        let outcome = match v["result"]["xml"].as_str() {
            Some(xml) => Ok(xml.to_string()),
            None => Err(v["error"]["message"]
                .as_str()
                .unwrap_or("inspect failed")
                .to_string()),
        };
        let _ = tx.send(outcome);
    }

    fn on_run(&self, payload: &[u8]) {
        let Ok(v) = serde_json::from_slice::<Value>(payload) else {
            return;
        };
        let pid = {
            let run = self.run.lock();
            match run.as_ref() {
                Some(r) if v["runId"].as_str() == Some(r.run_id.as_str()) => r.pid,
                _ => return,
            }
        };
        match v["type"].as_str() {
            Some("run.line") => self
                .events
                .run_line(pid, v["line"].as_str().unwrap_or_default()),
            Some("run.error") => {
                self.events.run_line(
                    pid,
                    &format!("[farm] {}", v["message"].as_str().unwrap_or("run refused")),
                );
                self.finish_run(pid, Some(1));
            }
            Some("run.exit") => self.finish_run(pid, v["code"].as_i64().map(|c| c as i32)),
            _ => {}
        }
    }

    /// Ends the run `pid` once: a close racing with run.exit must not emit two exits.
    fn finish_run(&self, pid: u32, code: Option<i32>) {
        let ended = {
            let mut run = self.run.lock();
            match run.as_ref() {
                Some(r) if r.pid == pid => run.take(),
                _ => None,
            }
        };
        if ended.is_some() {
            self.events.run_exit(pid, code);
        }
    }

    fn on_files(&self, payload: &[u8]) {
        let Some((&kind, data)) = payload.split_first() else {
            return;
        };
        if kind == FILES_CHUNK {
            if let Some(run) = self.run.lock().as_mut() {
                if let Some((_, buf)) = run.capture.as_mut() {
                    buf.extend_from_slice(data);
                }
            }
            return;
        }
        let Ok(v) = serde_json::from_slice::<Value>(data) else {
            return;
        };
        match v["type"].as_str() {
            Some("capture.begin") => {
                if let Some(run) = self.run.lock().as_mut() {
                    let path = v["path"].as_str().unwrap_or_default().to_string();
                    run.capture = Some((path, Vec::new()));
                }
            }
            Some("capture.end") => {
                let (dir, capture) = {
                    let mut run = self.run.lock();
                    match run.as_mut() {
                        Some(r) => (r.flow_dir.clone(), r.capture.take()),
                        None => return,
                    }
                };
                if let Some((path, bytes)) = capture {
                    write_capture(&dir, &path, &bytes);
                }
            }
            Some("apk.result") => {
                if let Some(tx) = self.apk_waiter.lock().take() {
                    let _ = tx.send(ApkResult {
                        ok: v["ok"].as_bool().unwrap_or(false),
                        packages: v["packages"]
                            .as_array()
                            .map(|a| {
                                a.iter()
                                    .filter_map(|p| p.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        message: v["message"].as_str().unwrap_or_default().to_string(),
                    });
                }
            }
            _ => {}
        }
    }

    pub async fn hierarchy(&self) -> AppResult<String> {
        if self.is_closed() {
            return Err(AppError::Other("the farm session has ended".into()));
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending_inspect.lock().insert(id, tx);
        self.send(json_frame(
            CH_INSPECT,
            &json!({"id": id, "method": "hierarchy"}),
        ))?;
        match tokio::time::timeout(INSPECT_TIMEOUT, rx).await {
            Ok(Ok(Ok(xml))) => Ok(xml),
            Ok(Ok(Err(message))) => Err(AppError::HierarchyParse(message)),
            _ => {
                self.pending_inspect.lock().remove(&id);
                Err(AppError::HierarchyParse(
                    "the farm phone did not answer the inspect request".into(),
                ))
            }
        }
    }

    pub async fn run(
        &self,
        bundle: FlowBundle,
        env: BTreeMap<String, String>,
        flow_dir: PathBuf,
        pid: u32,
    ) -> AppResult<()> {
        let run_id = format!("r{pid}");
        {
            let mut run = self.run.lock();
            // Checked under the run lock: mark_closed takes it too, so a run can
            // never be registered on a session that will not report its exit.
            if self.is_closed() {
                return Err(AppError::Other("the farm session has ended".into()));
            }
            if run.is_some() {
                return Err(AppError::RunnerFailed(
                    "a run is already in progress on this farm phone".into(),
                ));
            }
            *run = Some(RunState {
                pid,
                run_id: run_id.clone(),
                flow_dir,
                capture: None,
            });
        }
        let start = json!({"type": "run.start", "runId": run_id, "files": bundle.files, "entry": bundle.entry, "env": env});
        if let Err(e) = self.send(json_frame(CH_RUN, &start)) {
            self.run.lock().take();
            return Err(e);
        }
        Ok(())
    }

    pub async fn stop_run(&self, pid: u32) {
        let run_id = match self.run.lock().as_ref() {
            Some(r) if r.pid == pid => r.run_id.clone(),
            _ => return,
        };
        let _ = self.send(json_frame(
            CH_RUN,
            &json!({"type": "run.stop", "runId": run_id}),
        ));
    }

    pub async fn install_apk(&self, path: &Path) -> AppResult<ApkResult> {
        if self.is_closed() {
            return Err(AppError::Other("the farm session has ended".into()));
        }
        let size = tokio::fs::metadata(path).await?.len();
        if size == 0 || size > MAX_APK_BYTES {
            return Err(AppError::Other(
                "APKs must be between 1 byte and 300 MB".into(),
            ));
        }
        let data = tokio::fs::read(path).await?;
        let (tx, rx) = oneshot::channel();
        *self.apk_waiter.lock() = Some(tx);
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "app.apk".into());
        self.send(files_json(
            &json!({"type": "apk.begin", "name": name, "size": data.len()}),
        ))?;
        for chunk in data.chunks(CHUNK_BYTES) {
            self.send(files_chunk(chunk))?;
        }
        self.send(files_json(&json!({"type": "apk.end"})))?;
        match tokio::time::timeout(APK_TIMEOUT, rx).await {
            Ok(Ok(result)) => Ok(result),
            _ => Err(AppError::Other(
                "the farm phone did not confirm the install".into(),
            )),
        }
    }

    /// Ends the session from the app side (the gateway bills up to now).
    pub async fn release(&self) {
        if self
            .send(json_frame(CH_CONTROL, &json!({"type": "release"})))
            .is_ok()
        {
            // Give the frame a moment to leave (quitting exits right after this):
            // otherwise the gateway bills its 60 s grace before closing.
            for _ in 0..20 {
                if self.flushed() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
        self.mark_closed("user");
        if let Some((_, abort)) = self.video.lock().await.take() {
            let _ = abort.send(());
        }
    }

    fn send(&self, data: Vec<u8>) -> AppResult<()> {
        self.out_tx
            .send(data)
            .map_err(|_| AppError::Other("the farm session is closed".into()))?;
        self.queued.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

/// Writes a run capture next to the flow, refusing any path that would
/// escape the flow folder (the path comes from the wire).
fn write_capture(flow_dir: &Path, rel: &str, bytes: &[u8]) {
    let rel_path = Path::new(rel);
    if rel.is_empty()
        || rel_path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        warn!(path = rel, "refusing farm capture path");
        return;
    }
    let target = flow_dir.join(rel_path);
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&target, bytes) {
        warn!(path = %target.display(), error = %e, "could not write farm capture");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::farm::bundle::FlowBundle;
    use futures::{SinkExt, StreamExt};
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::sync::Mutex;
    use tokio::net::TcpListener;
    use tokio_tungstenite::{accept_async, tungstenite::Message, WebSocketStream};

    #[derive(Default)]
    struct Recorder {
        events: Mutex<Vec<SessionEvent>>,
        lines: Mutex<Vec<(u32, String)>>,
        exits: Mutex<Vec<(u32, Option<i32>)>>,
    }
    impl FarmEvents for Recorder {
        fn session(&self, e: SessionEvent) {
            self.events.lock().unwrap().push(e);
        }
        fn run_line(&self, pid: u32, line: &str) {
            self.lines.lock().unwrap().push((pid, line.into()));
        }
        fn run_exit(&self, pid: u32, code: Option<i32>) {
            self.exits.lock().unwrap().push((pid, code));
        }
    }

    type Ws = WebSocketStream<tokio::net::TcpStream>;

    async fn gateway() -> (String, TcpListener) {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        (format!("ws://{}", l.local_addr().unwrap()), l)
    }

    async fn accept(l: &TcpListener) -> Ws {
        let (s, _) = l.accept().await.unwrap();
        accept_async(s).await.unwrap()
    }

    fn hello() -> Vec<u8> {
        json_frame(
            CH_CONTROL,
            &json!({"type": "hello", "deviceId": "nuc1-S1", "model": "SM-S928B", "androidRelease": "15",
            "screen": {"width": 1080, "height": 2340, "density": 450}, "videoWidth": 472, "videoHeight": 1024,
            "minutesRemaining": 30, "maxEndsAt": 1.0e13}),
        )
    }

    fn header() -> Vec<u8> {
        let mut h = b"SM-S928B".to_vec();
        h.resize(64, 0);
        h.extend_from_slice(&0x6832_3634u32.to_be_bytes());
        h.extend_from_slice(&472u32.to_be_bytes());
        h.extend_from_slice(&1024u32.to_be_bytes());
        frame(CH_VIDEO, &h)
    }

    fn packet(flags: u64) -> Vec<u8> {
        let mut p = flags.to_be_bytes().to_vec();
        p.extend_from_slice(&3u32.to_be_bytes());
        p.extend_from_slice(&[1, 2, 3]);
        frame(CH_VIDEO, &p)
    }

    async fn next_frame(ws: &mut Ws) -> Vec<u8> {
        loop {
            match tokio::time::timeout(std::time::Duration::from_secs(5), ws.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap()
            {
                Message::Binary(b) => return b,
                _ => continue,
            }
        }
    }

    fn sink() -> (SharedSink, Arc<Mutex<usize>>) {
        let count = Arc::new(Mutex::new(0usize));
        let c = count.clone();
        (SharedSink::new(move |_| *c.lock().unwrap() += 1), count)
    }

    #[tokio::test]
    async fn full_session_video_input_inspect_run_and_close() {
        let (url, listener) = gateway().await;
        let rec = Arc::new(Recorder::default());
        let (sink, frames) = sink();
        let server = tokio::spawn(async move {
            let mut ws = accept(&listener).await;
            ws.send(Message::Binary(hello())).await.unwrap();
            ws.send(Message::Binary(header())).await.unwrap();
            ws.send(Message::Binary(packet(1 << 62))).await.unwrap();
            ws
        });
        let session = FarmSession::connect(&url, "tok", rec.clone(), sink)
            .await
            .unwrap();
        let mut ws = server.await.unwrap();
        assert_eq!(session.hello().unwrap().device_id, "nuc1-S1");

        // Input from the existing control channel goes out on channel 2.
        session.control_sender().send(vec![2, 9]).await.unwrap();
        assert_eq!(next_frame(&mut ws).await, vec![CH_INPUT, 2, 9]);

        // Inspect round trip.
        let s2 = session.clone();
        let inspect = tokio::spawn(async move { s2.hierarchy().await });
        let req = next_frame(&mut ws).await;
        let id = serde_json::from_slice::<serde_json::Value>(&req[1..]).unwrap()["id"].clone();
        ws.send(Message::Binary(json_frame(
            CH_INSPECT,
            &json!({"id": id, "result": {"xml": "<hierarchy/>"}}),
        )))
        .await
        .unwrap();
        assert_eq!(inspect.await.unwrap().unwrap(), "<hierarchy/>");

        // Run: lines, a capture written next to the flow, then exit.
        let flow_dir = tempfile::tempdir().unwrap();
        let bundle = FlowBundle {
            files: BTreeMap::from([("f.yaml".into(), "appId: a".into())]),
            entry: vec!["f.yaml".into()],
        };
        session
            .run(
                bundle,
                BTreeMap::new(),
                flow_dir.path().to_path_buf(),
                0x7000_0042,
            )
            .await
            .unwrap();
        let start = next_frame(&mut ws).await;
        let start: serde_json::Value = serde_json::from_slice(&start[1..]).unwrap();
        assert_eq!(start["type"], "run.start");
        let run_id = start["runId"].as_str().unwrap().to_string();
        ws.send(Message::Binary(json_frame(
            CH_RUN,
            &json!({"type": "run.line", "runId": run_id, "line": "COMPLETED"}),
        )))
        .await
        .unwrap();
        ws.send(Message::Binary(files_json(
            &json!({"type": "capture.begin", "runId": run_id, "path": "shots/home.png", "size": 3}),
        )))
        .await
        .unwrap();
        ws.send(Message::Binary(files_chunk(b"PNG"))).await.unwrap();
        ws.send(Message::Binary(files_json(
            &json!({"type": "capture.end", "runId": run_id, "path": "shots/home.png"}),
        )))
        .await
        .unwrap();
        ws.send(Message::Binary(json_frame(
            CH_RUN,
            &json!({"type": "run.exit", "runId": run_id, "code": 0, "junitXml": null}),
        )))
        .await
        .unwrap();
        for _ in 0..50 {
            if !rec.exits.lock().unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert_eq!(
            *rec.lines.lock().unwrap(),
            vec![(0x7000_0042, "COMPLETED".to_string())]
        );
        assert_eq!(*rec.exits.lock().unwrap(), vec![(0x7000_0042, Some(0))]);
        assert_eq!(
            std::fs::read(flow_dir.path().join("shots/home.png")).unwrap(),
            b"PNG"
        );
        assert!(*frames.lock().unwrap() >= 1, "video reached the frame sink");

        // The gateway ends the session.
        ws.send(Message::Binary(json_frame(
            CH_CONTROL,
            &json!({"type": "closing", "reason": "idle"}),
        )))
        .await
        .unwrap();
        ws.close(None).await.unwrap();
        for _ in 0..50 {
            if rec
                .events
                .lock()
                .unwrap()
                .iter()
                .any(|e| matches!(e, SessionEvent::Closing { .. }))
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert!(rec.events.lock().unwrap().contains(&SessionEvent::Closing {
            reason: "idle".into()
        }));
        assert!(!rec
            .events
            .lock()
            .unwrap()
            .contains(&SessionEvent::Reconnecting));
    }

    #[tokio::test]
    async fn stop_sends_run_stop_and_a_capture_cannot_escape_the_flow_folder() {
        let (url, listener) = gateway().await;
        let rec = Arc::new(Recorder::default());
        let server = tokio::spawn(async move {
            let mut ws = accept(&listener).await;
            ws.send(Message::Binary(hello())).await.unwrap();
            ws
        });
        let session = FarmSession::connect(&url, "tok", rec.clone(), sink().0)
            .await
            .unwrap();
        let mut ws = server.await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let flow_dir = dir.path().join("flows");
        std::fs::create_dir_all(&flow_dir).unwrap();
        let bundle = FlowBundle {
            files: BTreeMap::from([("f.yaml".into(), "x".into())]),
            entry: vec!["f.yaml".into()],
        };
        session
            .run(
                bundle.clone(),
                BTreeMap::new(),
                flow_dir.clone(),
                0x7000_0050,
            )
            .await
            .unwrap();
        assert!(
            session
                .run(bundle, BTreeMap::new(), flow_dir.clone(), 0x7000_0051)
                .await
                .is_err(),
            "one run at a time"
        );
        let start = next_frame(&mut ws).await;
        let run_id = serde_json::from_slice::<serde_json::Value>(&start[1..]).unwrap()["runId"]
            .as_str()
            .unwrap()
            .to_string();
        session.stop_run(0x7000_0050).await;
        let stop: serde_json::Value =
            serde_json::from_slice(&next_frame(&mut ws).await[1..]).unwrap();
        assert_eq!(stop, json!({"type": "run.stop", "runId": run_id}));
        ws.send(Message::Binary(files_json(
            &json!({"type": "capture.begin", "runId": run_id, "path": "../escape.png", "size": 1}),
        )))
        .await
        .unwrap();
        ws.send(Message::Binary(files_chunk(b"x"))).await.unwrap();
        ws.send(Message::Binary(files_json(
            &json!({"type": "capture.end", "runId": run_id, "path": "../escape.png"}),
        )))
        .await
        .unwrap();
        ws.send(Message::Binary(json_frame(
            CH_RUN,
            &json!({"type": "run.exit", "runId": run_id, "code": 1, "junitXml": null}),
        )))
        .await
        .unwrap();
        for _ in 0..50 {
            if !rec.exits.lock().unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert_eq!(*rec.exits.lock().unwrap(), vec![(0x7000_0050, Some(1))]);
        assert!(!dir.path().join("escape.png").exists());
    }

    #[tokio::test]
    async fn a_dropped_link_reconnects_and_restarts_video() {
        let (url, listener) = gateway().await;
        let rec = Arc::new(Recorder::default());
        let (sink, frames) = sink();
        let server = tokio::spawn(async move {
            let mut ws = accept(&listener).await;
            ws.send(Message::Binary(hello())).await.unwrap();
            ws.send(Message::Binary(header())).await.unwrap();
            drop(ws); // network drop, no closing message
            let mut ws2 = accept(&listener).await;
            ws2.send(Message::Binary(hello())).await.unwrap();
            ws2.send(Message::Binary(header())).await.unwrap();
            ws2.send(Message::Binary(packet(1 << 62))).await.unwrap();
            ws2
        });
        let session = FarmSession::connect(&url, "tok", rec.clone(), sink)
            .await
            .unwrap();
        for _ in 0..100 {
            if rec
                .events
                .lock()
                .unwrap()
                .contains(&SessionEvent::Reconnecting)
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert!(rec
            .events
            .lock()
            .unwrap()
            .contains(&SessionEvent::Reconnecting));
        session.reconnect(&url, "tok2").await.unwrap();
        let _ws2 = server.await.unwrap();
        for _ in 0..100 {
            if *frames.lock().unwrap() >= 1 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert!(
            *frames.lock().unwrap() >= 1,
            "video resumed after the new header"
        );
        assert!(rec
            .events
            .lock()
            .unwrap()
            .contains(&SessionEvent::Reconnected));
    }

    #[tokio::test]
    async fn closing_before_hello_fails_connect_with_the_reason() {
        let (url, listener) = gateway().await;
        tokio::spawn(async move {
            let mut ws = accept(&listener).await;
            ws.send(Message::Binary(json_frame(
                CH_CONTROL,
                &json!({"type": "closing", "reason": "agent_error"}),
            )))
            .await
            .unwrap();
            let _ = ws.close(None).await;
        });
        let err = FarmSession::connect(&url, "tok", Arc::new(Recorder::default()), sink().0)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("agent_error"), "{err}");
    }

    /// Real gateway + farm phone. Run with env from farm-gateway/scripts/mint-session.ts:
    /// `cargo test --lib farm_live -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn farm_live_end_to_end() {
        let url = std::env::var("FARM_E2E_URL").expect("FARM_E2E_URL");
        let token = std::env::var("FARM_E2E_TOKEN").expect("FARM_E2E_TOKEN");
        let rec = Arc::new(Recorder::default());
        let (sink, frames) = sink();
        let session = FarmSession::connect(&url, &token, rec.clone(), sink)
            .await
            .expect("connect");
        println!("hello: {:?}", session.hello());
        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
        assert!(
            *frames.lock().unwrap() > 0,
            "video frames decoded from the farm phone"
        );
        let xml = session.hierarchy().await.expect("hierarchy");
        assert!(xml.len() > 200, "hierarchy xml {}", xml.len());
        let flow = "appId: com.android.vending\n---\n- launchApp\n";
        let bundle = FlowBundle {
            files: BTreeMap::from([("flow.yaml".into(), flow.into())]),
            entry: vec!["flow.yaml".into()],
        };
        let dir = tempfile::tempdir().unwrap();
        session
            .run(
                bundle,
                BTreeMap::new(),
                dir.path().to_path_buf(),
                0x7000_1000,
            )
            .await
            .expect("run");
        for _ in 0..600 {
            if !rec.exits.lock().unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
        println!("lines: {:?}", rec.lines.lock().unwrap());
        assert_eq!(*rec.exits.lock().unwrap(), vec![(0x7000_1000, Some(0))]);
        session.release().await;
    }

    #[tokio::test]
    async fn a_closed_session_refuses_work_and_native_state_is_cleared() {
        let (url, listener) = gateway().await;
        let rec = Arc::new(Recorder::default());
        tokio::spawn(async move {
            let mut ws = accept(&listener).await;
            ws.send(Message::Binary(hello())).await.unwrap();
            ws.send(Message::Binary(json_frame(
                CH_CONTROL,
                &json!({"type": "closing", "reason": "idle"}),
            )))
            .await
            .unwrap();
            let _ = ws.close(None).await;
        });
        let session = FarmSession::connect(&url, "tok", rec.clone(), sink().0)
            .await
            .unwrap();
        for _ in 0..100 {
            if session.is_closed() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert!(session.is_closed());
        let bundle = FlowBundle {
            files: BTreeMap::from([("f.yaml".into(), "x".into())]),
            entry: vec!["f.yaml".into()],
        };
        assert!(session
            .run(bundle, BTreeMap::new(), std::env::temp_dir(), 0x7000_0060)
            .await
            .is_err());
        assert!(session.hierarchy().await.is_err());

        let state = crate::state::AppState::default();
        let (tx, _rx) = mpsc::channel(1);
        *state.control_tx.lock().await = Some(tx);
        *state.farm_session.lock().await = Some(session.clone());
        crate::farm::clear_if_closed(&state).await;
        assert!(state.farm_session.lock().await.is_none());
        assert!(state.control_tx.lock().await.is_none());
    }

    #[tokio::test]
    async fn release_reaches_the_gateway_before_returning() {
        let (url, listener) = gateway().await;
        let server = tokio::spawn(async move {
            let mut ws = accept(&listener).await;
            ws.send(Message::Binary(hello())).await.unwrap();
            next_frame(&mut ws).await
        });
        let session = FarmSession::connect(&url, "tok", Arc::new(Recorder::default()), sink().0)
            .await
            .unwrap();
        session.release().await;
        assert!(
            session.flushed(),
            "the release frame left before release() returned"
        );
        let got = server.await.unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&got[1..]).unwrap()["type"],
            "release"
        );
    }

    #[tokio::test]
    async fn a_run_ends_exactly_once_even_if_the_session_closes_at_the_same_time() {
        let rec = Arc::new(Recorder::default());
        let (url, listener) = gateway().await;
        let server = tokio::spawn(async move {
            let mut ws = accept(&listener).await;
            ws.send(Message::Binary(hello())).await.unwrap();
            ws
        });
        let session = FarmSession::connect(&url, "tok", rec.clone(), sink().0)
            .await
            .unwrap();
        let _ws = server.await.unwrap();
        let bundle = FlowBundle {
            files: BTreeMap::from([("f.yaml".into(), "x".into())]),
            entry: vec!["f.yaml".into()],
        };
        session
            .run(bundle, BTreeMap::new(), std::env::temp_dir(), 0x7000_0070)
            .await
            .unwrap();
        session.finish_run(0x7000_0070, Some(0));
        session.finish_run(0x7000_0070, Some(0));
        session.release().await;
        assert_eq!(rec.exits.lock().unwrap().len(), 1);
    }
}
