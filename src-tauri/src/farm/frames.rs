// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Wire format shared with the farm gateway and agent (spec, "Protocol").

pub const CH_CONTROL: u8 = 0;
pub const CH_VIDEO: u8 = 1;
pub const CH_INPUT: u8 = 2;
pub const CH_INSPECT: u8 = 3;
pub const CH_RUN: u8 = 4;
pub const CH_FILES: u8 = 5;
pub const FILES_JSON: u8 = 0;
pub const FILES_CHUNK: u8 = 1;
/// First video message: 64-byte device name + 12-byte codec meta.
pub const STREAM_HEADER_BYTES: usize = 76;
pub const CHUNK_BYTES: usize = 256 * 1024;

pub fn frame(channel: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 1);
    out.push(channel);
    out.extend_from_slice(payload);
    out
}

pub fn json_frame(channel: u8, value: &serde_json::Value) -> Vec<u8> {
    frame(channel, value.to_string().as_bytes())
}

pub fn files_json(value: &serde_json::Value) -> Vec<u8> {
    let mut payload = vec![FILES_JSON];
    payload.extend_from_slice(value.to_string().as_bytes());
    frame(CH_FILES, &payload)
}

pub fn files_chunk(data: &[u8]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(data.len() + 1);
    payload.push(FILES_CHUNK);
    payload.extend_from_slice(data);
    frame(CH_FILES, &payload)
}

pub fn split(data: &[u8]) -> Option<(u8, &[u8])> {
    data.split_first().map(|(channel, rest)| (*channel, rest))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn frames_round_trip() {
        assert_eq!(
            split(&frame(CH_INPUT, &[1, 2])),
            Some((CH_INPUT, &[1u8, 2][..]))
        );
        assert_eq!(split(&[]), None);
        let f = json_frame(CH_RUN, &json!({"type": "run.stop"}));
        let (ch, payload) = split(&f).unwrap();
        assert_eq!(ch, CH_RUN);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(payload).unwrap()["type"],
            "run.stop"
        );
    }

    #[test]
    fn files_payloads_carry_a_kind_byte() {
        assert_eq!(files_chunk(b"ab"), vec![CH_FILES, FILES_CHUNK, b'a', b'b']);
        let j = files_json(&json!({"type": "apk.end"}));
        assert_eq!(&j[..2], &[CH_FILES, FILES_JSON]);
    }
}
