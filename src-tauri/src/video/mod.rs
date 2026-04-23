//! H.264 decoding pipeline. Stub — agent fills in (plan §4 Phase 2).
//!
//! Strategy: native decode behind `hwdecode` feature, WebCodecs fallback otherwise.
use crate::error::AppResult;

pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub pts_ms: u64,
}

pub fn decode_nal(_nal: &[u8]) -> AppResult<Option<Frame>> {
    Ok(None)
}
