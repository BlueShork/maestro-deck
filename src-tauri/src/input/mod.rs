//! Input forwarding via scrcpy control protocol. Stub — agent fills in (plan §4 Phase 3).
use crate::error::AppResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InputEvent {
    Tap { x: f32, y: f32 },
    Swipe { x1: f32, y1: f32, x2: f32, y2: f32, duration_ms: u32 },
    Text { text: String },
    Key { keycode: i32 },
}

pub fn send(_event: &InputEvent) -> AppResult<()> {
    Ok(())
}
