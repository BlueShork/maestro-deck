//! scrcpy 2.7 video + control stream over the adb-forward TCP tunnel.
//!
//! Wire format (`tunnel_forward=true`, `audio=false`, `control=true`):
//!
//! 1. The client opens **two** TCP connections to `127.0.0.1:DEFAULT_PORT`:
//!    first the **video** socket, then the **control** socket.
//! 2. On the *first* socket only, the server prefixes a 65-byte device meta
//!    header: 1 byte status (0 = OK, anything else = error) followed by 64 bytes
//!    of NUL-padded UTF-8 device name.
//! 3. On the **video** socket the server then sends a 12-byte codec meta
//!    header: codec_id (u32 BE; "h264" = 0x68_32_36_34), width (u32 BE),
//!    height (u32 BE).
//! 4. Then a continuous stream of frame packets: 8-byte BE PTS where the top
//!    two bits are flags (bit 63 = config / SPS+PPS payload, bit 62 = key
//!    frame); 4-byte BE size; `size` bytes of Annex-B NAL units.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio::time::sleep;
use tracing::{debug, info, warn};

use crate::error::{AppError, AppResult};

/// "h264" in big-endian ASCII, matching scrcpy's u32 codec id.
const CODEC_ID_H264: u32 = 0x68_32_36_34;
/// Top bit of the PTS u64 marks a config (SPS/PPS) packet.
const PTS_FLAG_CONFIG: u64 = 1 << 63;
/// Second-from-top bit marks a key frame.
const PTS_FLAG_KEY: u64 = 1 << 62;
/// Mask isolating the actual PTS in microseconds.
const PTS_VALUE_MASK: u64 = !(PTS_FLAG_CONFIG | PTS_FLAG_KEY);

const FRAME_EVENT: &str = "frame";

const CONNECT_RETRIES: u32 = 40;
const CONNECT_BACKOFF: Duration = Duration::from_millis(75);

/// Payload for the `frame` Tauri event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FramePayload {
    pub pts_us: u64,
    pub is_config: bool,
    pub is_key: bool,
    pub data: Vec<u8>,
}

/// Stream metadata returned to the caller when the video socket is initialised.
pub struct StreamHandle {
    pub width: u32,
    pub height: u32,
    pub abort: oneshot::Sender<()>,
}

async fn connect_with_retry(port: u16) -> AppResult<TcpStream> {
    let addr = format!("127.0.0.1:{port}");
    let mut last_err: Option<std::io::Error> = None;
    for attempt in 0..CONNECT_RETRIES {
        match TcpStream::connect(&addr).await {
            Ok(s) => return Ok(s),
            Err(e) => {
                debug!(attempt, error = %e, "scrcpy tunnel not ready yet");
                last_err = Some(e);
                sleep(CONNECT_BACKOFF).await;
            }
        }
    }
    Err(AppError::ScrcpyFailed(format!(
        "tunnel connect failed after {CONNECT_RETRIES} attempts: {}",
        last_err
            .map(|e| e.to_string())
            .unwrap_or_else(|| "unknown error".into())
    )))
}

/// Read the 1-byte dummy status prefix. scrcpy 3.x sends this as soon as the
/// first socket is accepted — before the server blocks on any other expected
/// socket (audio/control). This lets the client distinguish "server ready"
/// from "adb forward accepted a premature connection".
async fn read_dummy<R: AsyncReadExt + Unpin>(r: &mut R) -> AppResult<()> {
    let dummy = r
        .read_u8()
        .await
        .map_err(|e| AppError::ScrcpyFailed(format!("read dummy: {e}")))?;
    if dummy != 0 {
        return Err(AppError::ScrcpyFailed(format!(
            "device meta status byte = {dummy} (expected 0)"
        )));
    }
    Ok(())
}

/// Read the 64-byte NUL-padded device name — sent AFTER all other expected
/// sockets (audio, control) have connected.
async fn read_device_name<R: AsyncReadExt + Unpin>(r: &mut R) -> AppResult<String> {
    let mut name_buf = [0u8; 64];
    r.read_exact(&mut name_buf)
        .await
        .map_err(|e| AppError::ScrcpyFailed(format!("read device name: {e}")))?;
    let end = name_buf.iter().position(|&b| b == 0).unwrap_or(64);
    Ok(String::from_utf8_lossy(&name_buf[..end]).into_owned())
}

/// Read the 12-byte video codec meta header.
async fn read_codec_meta<R: AsyncReadExt + Unpin>(r: &mut R) -> AppResult<(u32, u32, u32)> {
    let codec_id = r
        .read_u32()
        .await
        .map_err(|e| AppError::ScrcpyFailed(format!("read codec_id: {e}")))?;
    let width = r
        .read_u32()
        .await
        .map_err(|e| AppError::ScrcpyFailed(format!("read width: {e}")))?;
    let height = r
        .read_u32()
        .await
        .map_err(|e| AppError::ScrcpyFailed(format!("read height: {e}")))?;
    Ok((codec_id, width, height))
}

/// Sink abstraction so the read loop can be unit-tested without a Tauri app.
pub trait FrameSink: Send + 'static {
    fn emit(&self, payload: FramePayload);
}

impl FrameSink for AppHandle {
    fn emit(&self, payload: FramePayload) {
        if let Err(e) = Emitter::emit(self, FRAME_EVENT, &payload) {
            warn!(error = %e, "failed to emit frame event");
        }
    }
}

/// Read frame packets until EOF or the abort signal fires.
pub async fn read_frame_loop<R, S>(
    mut reader: R,
    sink: S,
    mut abort: oneshot::Receiver<()>,
) -> AppResult<()>
where
    R: AsyncReadExt + Unpin,
    S: FrameSink,
{
    let mut frame_count: u64 = 0;
    loop {
        let header = tokio::select! {
            biased;
            _ = &mut abort => {
                info!("video stream aborted by caller");
                return Ok(());
            }
            res = read_frame_header(&mut reader) => res,
        };
        let Some((pts_raw, size)) = header? else {
            info!("video stream closed by peer");
            return Ok(());
        };
        let mut buf = vec![0u8; size as usize];
        reader
            .read_exact(&mut buf)
            .await
            .map_err(|e| AppError::ScrcpyFailed(format!("read frame body: {e}")))?;

        let is_config = (pts_raw & PTS_FLAG_CONFIG) != 0;
        let is_key = (pts_raw & PTS_FLAG_KEY) != 0;

        frame_count += 1;
        if frame_count <= 3 || frame_count % 60 == 0 {
            info!(n = frame_count, size, is_config, is_key, "frame emitted");
        }
        let pts_us = pts_raw & PTS_VALUE_MASK;
        sink.emit(FramePayload {
            pts_us,
            is_config,
            is_key,
            data: buf,
        });
    }
}

/// Returns Ok(None) on clean EOF before the next packet.
async fn read_frame_header<R: AsyncReadExt + Unpin>(r: &mut R) -> AppResult<Option<(u64, u32)>> {
    let mut pts_bytes = [0u8; 8];
    match r.read_exact(&mut pts_bytes).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(AppError::ScrcpyFailed(format!("read pts: {e}"))),
    }
    let pts = u64::from_be_bytes(pts_bytes);
    let size = r
        .read_u32()
        .await
        .map_err(|e| AppError::ScrcpyFailed(format!("read size: {e}")))?;
    Ok(Some((pts, size)))
}

/// Connect to the video socket and retry until we see a clean dummy byte.
/// `adb forward` accepts TCP connections even before scrcpy binds the
/// abstract socket — those premature connections close with EOF on the first
/// read. We retry the whole connect+dummy sequence until success.
async fn open_video_with_dummy(port: u16) -> AppResult<TcpStream> {
    let addr = format!("127.0.0.1:{port}");
    let mut last_err: Option<AppError> = None;
    for attempt in 0..CONNECT_RETRIES {
        match TcpStream::connect(&addr).await {
            Ok(mut sock) => match read_dummy(&mut sock).await {
                Ok(()) => return Ok(sock),
                Err(e) => {
                    debug!(attempt, error = %e, "scrcpy dummy not ready yet");
                    last_err = Some(e);
                }
            },
            Err(e) => {
                debug!(attempt, error = %e, "scrcpy tunnel not ready yet");
                last_err = Some(AppError::ScrcpyFailed(e.to_string()));
            }
        }
        sleep(CONNECT_BACKOFF).await;
    }
    Err(AppError::ScrcpyFailed(format!(
        "video socket handshake failed after {CONNECT_RETRIES} attempts: {}",
        last_err
            .map(|e| e.to_string())
            .unwrap_or_else(|| "unknown error".into())
    )))
}

/// Connect both sockets in scrcpy's expected order (video first, then
/// control), perform the device-meta handshake, and spawn the read/write
/// tasks. scrcpy blocks on the device-name + codec-meta send until ALL
/// declared sockets are connected, so we MUST open control before reading
/// meta from video.
pub async fn spawn_session(
    app: AppHandle,
    port: u16,
    mut control_rx: mpsc::Receiver<Vec<u8>>,
) -> AppResult<StreamHandle> {
    let mut video = open_video_with_dummy(port).await?;
    let mut control = connect_with_retry(port).await?;

    let device_name = read_device_name(&mut video).await?;
    info!(%device_name, "scrcpy device meta received");
    let (codec_id, width, height) = read_codec_meta(&mut video).await?;
    if codec_id != CODEC_ID_H264 {
        warn!(
            codec_id = format!("0x{codec_id:08X}"),
            "unexpected codec id (expected h264)"
        );
    }
    info!(width, height, "scrcpy video meta received");

    let (abort_tx, abort_rx) = oneshot::channel();
    tokio::spawn(async move {
        if let Err(e) = read_frame_loop(video, app, abort_rx).await {
            warn!(error = %e, "video stream loop ended with error");
        }
    });
    tokio::spawn(async move {
        while let Some(msg) = control_rx.recv().await {
            if let Err(e) = control.write_all(&msg).await {
                warn!(error = %e, "control write failed; closing");
                break;
            }
        }
        debug!("control writer exiting");
    });

    Ok(StreamHandle {
        width,
        height,
        abort: abort_tx,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{duplex, AsyncWriteExt, DuplexStream};

    #[derive(Clone, Default)]
    struct CollectingSink {
        frames: Arc<Mutex<Vec<FramePayload>>>,
    }

    impl FrameSink for CollectingSink {
        fn emit(&self, payload: FramePayload) {
            self.frames.lock().expect("poisoned").push(payload);
        }
    }

    fn frame_packet(pts: u64, body: &[u8]) -> Vec<u8> {
        let mut v = Vec::with_capacity(12 + body.len());
        v.extend_from_slice(&pts.to_be_bytes());
        v.extend_from_slice(&(body.len() as u32).to_be_bytes());
        v.extend_from_slice(body);
        v
    }

    async fn write_meta(server: &mut DuplexStream) {
        // dummy=0, 64-byte name "Pixel\0..."
        let mut name = [0u8; 64];
        name[..5].copy_from_slice(b"Pixel");
        server.write_u8(0).await.expect("write dummy");
        server.write_all(&name).await.expect("write name");
        // codec meta: h264, 1080, 2400
        server
            .write_u32(CODEC_ID_H264)
            .await
            .expect("write codec_id");
        server.write_u32(1080).await.expect("write width");
        server.write_u32(2400).await.expect("write height");
    }

    #[tokio::test]
    async fn parses_meta_and_two_frames() {
        let (mut server, mut client) = duplex(8 * 1024);
        let writer = tokio::spawn(async move {
            write_meta(&mut server).await;
            // config packet (SPS+PPS payload)
            server
                .write_all(&frame_packet(PTS_FLAG_CONFIG, &[0xAA, 0xBB]))
                .await
                .unwrap();
            // key frame at 1_000_000us
            server
                .write_all(&frame_packet(PTS_FLAG_KEY | 1_000_000, &[1, 2, 3, 4]))
                .await
                .unwrap();
            // close socket -> EOF
            drop(server);
        });

        read_dummy(&mut client).await.expect("dummy");
        let device = read_device_name(&mut client).await.expect("device name");
        assert_eq!(device, "Pixel");
        let (codec, w, h) = read_codec_meta(&mut client).await.expect("codec meta");
        assert_eq!(codec, CODEC_ID_H264);
        assert_eq!((w, h), (1080, 2400));

        let sink = CollectingSink::default();
        let (_abort_tx, abort_rx) = oneshot::channel();
        read_frame_loop(client, sink.clone(), abort_rx)
            .await
            .expect("loop ok");
        writer.await.expect("writer task");

        let frames = sink.frames.lock().unwrap();
        assert_eq!(frames.len(), 2);
        assert!(frames[0].is_config);
        assert!(!frames[0].is_key);
        assert_eq!(frames[0].data, vec![0xAA, 0xBB]);
        assert_eq!(frames[0].pts_us, 0);

        assert!(!frames[1].is_config);
        assert!(frames[1].is_key);
        assert_eq!(frames[1].pts_us, 1_000_000);
        assert_eq!(frames[1].data, vec![1, 2, 3, 4]);
    }

    #[tokio::test]
    async fn nonzero_dummy_returns_error() {
        let (mut server, mut client) = duplex(128);
        tokio::spawn(async move {
            server.write_u8(1).await.unwrap();
            let zeros = [0u8; 64];
            server.write_all(&zeros).await.unwrap();
        });
        let res = read_dummy(&mut client).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn pts_flags_split_correctly() {
        let (mut server, mut client) = duplex(1024);
        tokio::spawn(async move {
            // both flags + value 42
            server
                .write_all(&frame_packet(PTS_FLAG_CONFIG | PTS_FLAG_KEY | 42, &[0xFF]))
                .await
                .unwrap();
            drop(server);
        });
        let sink = CollectingSink::default();
        let (_abort_tx, abort_rx) = oneshot::channel();
        read_frame_loop(&mut client, sink.clone(), abort_rx)
            .await
            .expect("loop ok");
        let frames = sink.frames.lock().unwrap();
        assert_eq!(frames.len(), 1);
        assert!(frames[0].is_config);
        assert!(frames[0].is_key);
        assert_eq!(frames[0].pts_us, 42);
    }

    #[tokio::test]
    async fn abort_stops_loop() {
        // Server end stays open but never writes; the abort signal must
        // unblock the read loop without needing data.
        let (_server, client) = duplex(64);
        let sink = CollectingSink::default();
        let (abort_tx, abort_rx) = oneshot::channel();
        let task = tokio::spawn(async move {
            read_frame_loop(client, sink, abort_rx).await.expect("ok");
        });
        abort_tx.send(()).expect("send abort");
        task.await.expect("task joined");
    }
}
