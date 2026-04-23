//! H.264 decoding pipeline.
//!
//! Real hardware decoding lives behind the `hwdecode` feature flag. The default
//! build exposes the types and NAL-unit framing needed by higher layers but
//! returns `Ok(None)` for every frame — the frontend uses WebCodecs as fallback.

use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// Decoded RGBA frame (row-major, width*height*4 bytes).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub pts_ms: u64,
}

/// NAL unit types we care about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum NalType {
    Slice = 1,
    Idr = 5,
    Sei = 6,
    Sps = 7,
    Pps = 8,
    Aud = 9,
    Other = 0,
}

impl NalType {
    pub fn from_byte(b: u8) -> Self {
        match b & 0x1F {
            1 => Self::Slice,
            5 => Self::Idr,
            6 => Self::Sei,
            7 => Self::Sps,
            8 => Self::Pps,
            9 => Self::Aud,
            _ => Self::Other,
        }
    }
}

/// Split an Annex-B bytestream into NAL units. Tolerates 3-byte or 4-byte start codes.
/// Each returned slice is the payload (excludes start code).
pub fn split_nal_units(stream: &[u8]) -> Vec<&[u8]> {
    // (start_of_payload, start_of_start_code)
    let mut marks: Vec<(usize, usize)> = Vec::new();
    let mut i = 0;
    while i + 3 <= stream.len() {
        if stream[i] == 0 && stream[i + 1] == 0 {
            if i + 4 <= stream.len() && stream[i + 2] == 0 && stream[i + 3] == 1 {
                marks.push((i + 4, i));
                i += 4;
                continue;
            }
            if stream[i + 2] == 1 {
                marks.push((i + 3, i));
                i += 3;
                continue;
            }
        }
        i += 1;
    }

    let mut out = Vec::with_capacity(marks.len());
    for (idx, &(payload_start, _)) in marks.iter().enumerate() {
        let end = marks
            .get(idx + 1)
            .map(|(_, next_sc)| *next_sc)
            .unwrap_or(stream.len());
        if payload_start < end {
            out.push(&stream[payload_start..end]);
        }
    }
    out
}

#[cfg(not(feature = "hwdecode"))]
pub fn decode_nal(_nal: &[u8]) -> AppResult<Option<Frame>> {
    // WebCodecs fallback: the frontend receives raw NAL units via a Tauri event
    // and decodes them using the browser's VideoDecoder. Nothing to do here.
    Ok(None)
}

#[cfg(feature = "hwdecode")]
pub fn decode_nal(_nal: &[u8]) -> AppResult<Option<Frame>> {
    // TODO: wire up openh264-sys2 here. Deferred until a device is available.
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nal_type_from_byte_masks_low_5_bits() {
        assert_eq!(NalType::from_byte(0x65), NalType::Idr); // forbidden_zero_bit + IDR
        assert_eq!(NalType::from_byte(0x67), NalType::Sps);
        assert_eq!(NalType::from_byte(0x68), NalType::Pps);
        assert_eq!(NalType::from_byte(0x41), NalType::Slice);
    }

    #[test]
    fn split_single_nal_with_4byte_start_code() {
        let s = [0x00, 0x00, 0x00, 0x01, 0x67, 0xAA, 0xBB];
        let nals = split_nal_units(&s);
        assert_eq!(nals.len(), 1);
        assert_eq!(nals[0], &[0x67, 0xAA, 0xBB]);
    }

    #[test]
    fn split_two_nals_mixed_start_codes() {
        let s = [
            0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0x00, 0x00, 0x01, 0x68, 0xCE,
        ];
        let nals = split_nal_units(&s);
        assert_eq!(nals.len(), 2);
        assert_eq!(nals[0], &[0x67, 0x42]);
        assert_eq!(nals[1], &[0x68, 0xCE]);
    }

    #[test]
    fn decode_returns_none_in_fallback() {
        assert!(decode_nal(&[0x67, 0x42]).unwrap().is_none());
    }
}
