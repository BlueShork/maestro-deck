//! Performance metrics collector for the Android app currently in foreground.
//!
//! Spawns a single Tokio polling task controlled by a oneshot cancellation
//! channel (same pattern as `runner`). Parsers live in `parsers.rs` and are
//! pure. `collector.rs` wires ADB calls to parsers. `foreground.rs` resolves
//! the target package and caches PID/UID.

pub mod collector;
pub mod foreground;
pub mod parsers;
