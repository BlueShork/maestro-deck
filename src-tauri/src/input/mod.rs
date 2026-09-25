// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Input forwarding via the scrcpy control protocol.
//!
//! See https://github.com/Genymobile/scrcpy/blob/master/doc/develop.md —
//! all integers on the wire are big-endian.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub mod ios;
pub mod web;

// Control message type codes (subset).
pub const TYPE_INJECT_KEYCODE: u8 = 0;
pub const TYPE_INJECT_TEXT: u8 = 1;
pub const TYPE_INJECT_TOUCH_EVENT: u8 = 2;

// Android MotionEvent actions.
pub const ACTION_DOWN: u8 = 0;
pub const ACTION_UP: u8 = 1;
pub const ACTION_MOVE: u8 = 2;

// Android KeyEvent actions.
pub const KEY_ACTION_DOWN: u8 = 0;
pub const KEY_ACTION_UP: u8 = 1;

// Synthetic pointer id used by scrcpy for a single-finger touch.
pub const POINTER_ID_FINGER: u64 = 0xFFFF_FFFF_FFFF_FFFF;

// Full pressure (16-bit fixed-point, 0..=1).
pub const PRESSURE_DOWN: u16 = 0xFFFF;
pub const PRESSURE_UP: u16 = 0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InputEvent {
    Tap {
        x: f32,
        y: f32,
    },
    Swipe {
        x1: f32,
        y1: f32,
        x2: f32,
        y2: f32,
        duration_ms: u32,
    },
    Text {
        text: String,
    },
    Key {
        keycode: i32,
    },
}

/// Encode an INJECT_TOUCH_EVENT control message.
pub fn encode_touch(
    action: u8,
    pointer_id: u64,
    x: i32,
    y: i32,
    screen_w: u16,
    screen_h: u16,
    pressure: u16,
    buttons: u32,
) -> Vec<u8> {
    // 1 + 1 + 8 + 4 + 4 + 2 + 2 + 2 + 4 + 4 = 32 bytes
    let mut buf = Vec::with_capacity(32);
    buf.push(TYPE_INJECT_TOUCH_EVENT);
    buf.push(action);
    buf.extend_from_slice(&pointer_id.to_be_bytes());
    buf.extend_from_slice(&x.to_be_bytes());
    buf.extend_from_slice(&y.to_be_bytes());
    buf.extend_from_slice(&screen_w.to_be_bytes());
    buf.extend_from_slice(&screen_h.to_be_bytes());
    buf.extend_from_slice(&pressure.to_be_bytes());
    // action_button (u32 BE) — unused for a single finger, 0.
    buf.extend_from_slice(&0u32.to_be_bytes());
    buf.extend_from_slice(&buttons.to_be_bytes());
    buf
}

/// Encode an INJECT_TEXT control message.
pub fn encode_text(text: &str) -> Vec<u8> {
    let bytes = text.as_bytes();
    let mut buf = Vec::with_capacity(5 + bytes.len());
    buf.push(TYPE_INJECT_TEXT);
    buf.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    buf.extend_from_slice(bytes);
    buf
}

/// Encode an INJECT_KEYCODE control message.
pub fn encode_keycode(action: u8, keycode: i32, repeat: u32, meta_state: u32) -> Vec<u8> {
    // 1 + 1 + 4 + 4 + 4 = 14 bytes
    let mut buf = Vec::with_capacity(14);
    buf.push(TYPE_INJECT_KEYCODE);
    buf.push(action);
    buf.extend_from_slice(&keycode.to_be_bytes());
    buf.extend_from_slice(&repeat.to_be_bytes());
    buf.extend_from_slice(&meta_state.to_be_bytes());
    buf
}

/// Encode a tap as a (DOWN, UP) pair at integer pixel coords within the given viewport.
pub fn encode_tap(x: i32, y: i32, screen_w: u16, screen_h: u16) -> Vec<Vec<u8>> {
    vec![
        encode_touch(
            ACTION_DOWN,
            POINTER_ID_FINGER,
            x,
            y,
            screen_w,
            screen_h,
            PRESSURE_DOWN,
            1,
        ),
        encode_touch(
            ACTION_UP,
            POINTER_ID_FINGER,
            x,
            y,
            screen_w,
            screen_h,
            PRESSURE_UP,
            0,
        ),
    ]
}

/// Encode a swipe as DOWN + N MOVE + UP with `steps` intermediate samples.
pub fn encode_swipe(
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
    steps: u32,
    screen_w: u16,
    screen_h: u16,
) -> Vec<Vec<u8>> {
    let steps = steps.max(1);
    let mut out = Vec::with_capacity((steps + 2) as usize);
    out.push(encode_touch(
        ACTION_DOWN,
        POINTER_ID_FINGER,
        x1,
        y1,
        screen_w,
        screen_h,
        PRESSURE_DOWN,
        1,
    ));
    for i in 1..=steps {
        let t = i as f32 / (steps + 1) as f32;
        let x = x1 as f32 + (x2 - x1) as f32 * t;
        let y = y1 as f32 + (y2 - y1) as f32 * t;
        out.push(encode_touch(
            ACTION_MOVE,
            POINTER_ID_FINGER,
            x.round() as i32,
            y.round() as i32,
            screen_w,
            screen_h,
            PRESSURE_DOWN,
            1,
        ));
    }
    out.push(encode_touch(
        ACTION_UP,
        POINTER_ID_FINGER,
        x2,
        y2,
        screen_w,
        screen_h,
        PRESSURE_UP,
        0,
    ));
    out
}

/// High-level entry used by the IPC handler. Encodes the event with the
/// helpers above and pushes each control message to the scrcpy control socket
/// via the channel held in [`AppState`].
pub async fn send(
    event: &InputEvent,
    state: &AppState,
    screen_w: u16,
    screen_h: u16,
) -> AppResult<()> {
    let tx = {
        let guard = state.control_tx.lock().await;
        guard.clone().ok_or(AppError::NoDevice)?
    };

    let messages: Vec<Vec<u8>> = match event {
        InputEvent::Tap { x, y } => {
            encode_tap(x.round() as i32, y.round() as i32, screen_w, screen_h)
        }
        InputEvent::Swipe {
            x1,
            y1,
            x2,
            y2,
            duration_ms,
        } => {
            // Use ~16ms per step (≈60Hz) and clamp so very short swipes still
            // emit at least one MOVE event.
            let steps = (duration_ms / 16).max(1);
            encode_swipe(
                x1.round() as i32,
                y1.round() as i32,
                x2.round() as i32,
                y2.round() as i32,
                steps,
                screen_w,
                screen_h,
            )
        }
        InputEvent::Text { text } => vec![encode_text(text)],
        InputEvent::Key { keycode } => vec![
            encode_keycode(KEY_ACTION_DOWN, *keycode, 0, 0),
            encode_keycode(KEY_ACTION_UP, *keycode, 0, 0),
        ],
    };

    for msg in messages {
        tx.send(msg)
            .await
            .map_err(|e| AppError::ScrcpyFailed(format!("control channel closed: {e}")))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_touch_layout() {
        let buf = encode_touch(
            ACTION_DOWN,
            POINTER_ID_FINGER,
            100,
            200,
            1080,
            2400,
            0xFFFF,
            1,
        );
        assert_eq!(buf.len(), 32);
        assert_eq!(buf[0], TYPE_INJECT_TOUCH_EVENT);
        assert_eq!(buf[1], ACTION_DOWN);
        assert_eq!(&buf[2..10], &POINTER_ID_FINGER.to_be_bytes());
        assert_eq!(&buf[10..14], &100i32.to_be_bytes());
        assert_eq!(&buf[14..18], &200i32.to_be_bytes());
        assert_eq!(&buf[18..20], &1080u16.to_be_bytes());
        assert_eq!(&buf[20..22], &2400u16.to_be_bytes());
        assert_eq!(&buf[22..24], &0xFFFFu16.to_be_bytes());
        assert_eq!(&buf[24..28], &0u32.to_be_bytes());
        assert_eq!(&buf[28..32], &1u32.to_be_bytes());
    }

    #[test]
    fn encode_text_layout() {
        let buf = encode_text("hi");
        assert_eq!(buf[0], TYPE_INJECT_TEXT);
        assert_eq!(&buf[1..5], &2u32.to_be_bytes());
        assert_eq!(&buf[5..], b"hi");
    }

    #[test]
    fn encode_text_utf8() {
        let buf = encode_text("éà");
        let payload = "éà".as_bytes();
        assert_eq!(&buf[1..5], &(payload.len() as u32).to_be_bytes());
        assert_eq!(&buf[5..], payload);
    }

    #[test]
    fn encode_keycode_layout() {
        let buf = encode_keycode(KEY_ACTION_DOWN, 4, 0, 0);
        assert_eq!(buf.len(), 14);
        assert_eq!(buf[0], TYPE_INJECT_KEYCODE);
        assert_eq!(buf[1], KEY_ACTION_DOWN);
        assert_eq!(&buf[2..6], &4i32.to_be_bytes());
        assert_eq!(&buf[6..10], &0u32.to_be_bytes());
        assert_eq!(&buf[10..14], &0u32.to_be_bytes());
    }

    #[test]
    fn tap_emits_two_messages() {
        let msgs = encode_tap(500, 600, 1080, 2400);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0][1], ACTION_DOWN);
        assert_eq!(msgs[1][1], ACTION_UP);
    }

    #[test]
    fn swipe_has_steps_plus_down_up() {
        let msgs = encode_swipe(0, 0, 100, 0, 3, 1080, 2400);
        assert_eq!(msgs.len(), 5);
        assert_eq!(msgs[0][1], ACTION_DOWN);
        assert_eq!(msgs[4][1], ACTION_UP);
        for m in &msgs[1..=3] {
            assert_eq!(m[1], ACTION_MOVE);
        }
    }
}
