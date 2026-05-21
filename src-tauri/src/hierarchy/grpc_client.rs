// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Direct gRPC client for the on-device Maestro driver.
//!
//! Once a background `maestro studio` process (see `studio` submodule)
//! has installed + started the driver and set up the adb forward,
//! `localhost:7001` exposes the `maestro_android.MaestroDriver` service.
//! This module connects a tonic client to that endpoint and exposes a
//! thin `dump_hierarchy` function that mirrors the CLI-based
//! `super::dump_hierarchy` signature, so the caller can swap between
//! the two paths based on a user setting.
//!
//! Why this is fast: the CLI invocation pays JVM cold-start (~3 s) and
//! driver (re)install (~5-7 s) on every call. The studio process pays
//! those once up-front; subsequent gRPC calls just roundtrip the
//! accessibility-tree XML through an already-warm pipe.

use std::time::{Duration, Instant};

use tonic::transport::{Channel, Endpoint};
use tonic::Request;
use tracing::{debug, info};

use crate::error::{AppError, AppResult};
use crate::hierarchy::proto::{maestro_driver_client::MaestroDriverClient, ViewHierarchyRequest};
use crate::hierarchy::{parse_xml, studio::DRIVER_PORT, HierarchyTree};

/// Per-RPC deadline. The driver normally responds in <300 ms; 10 s is
/// a generous ceiling that still fails fast if the driver hangs (e.g.
/// the app under test has frozen and accessibility events aren't
/// flowing) instead of blocking the UI indefinitely.
const RPC_TIMEOUT: Duration = Duration::from_secs(10);
/// How long we allow the TCP connect + HTTP/2 handshake. Port is on
/// localhost so this should be sub-second.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// A real UiAutomator dump is at least a few hundred bytes (header +
/// one window node with bounds). An orphan studio whose on-device
/// driver has died still accepts the RPC but replies with the bare
/// `<hierarchy rotation="0"/>` wrapper (~84 bytes). Below this
/// threshold we treat the response as "driver is a zombie" and fail
/// so the caller can kill the keeper and respawn.
const MIN_VALID_HIERARCHY_BYTES: usize = 200;

async fn connect() -> AppResult<MaestroDriverClient<Channel>> {
    let uri = format!("http://127.0.0.1:{DRIVER_PORT}");
    let endpoint = Endpoint::from_shared(uri.clone())
        .map_err(|e| AppError::HierarchyParse(format!("invalid driver uri {uri}: {e}")))?
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(RPC_TIMEOUT)
        // Studio keeps the driver alive for the whole inspect session;
        // HTTP/2 keepalive lets us notice socket death (device unplug,
        // studio crash) without waiting for the first failed RPC.
        .keep_alive_while_idle(true)
        .http2_keep_alive_interval(Duration::from_secs(30));

    let channel = endpoint
        .connect()
        .await
        .map_err(|e| AppError::HierarchyParse(format!("failed to connect to driver: {e}")))?;
    Ok(MaestroDriverClient::new(channel))
}

/// Fetch a hierarchy dump via direct gRPC to the on-device driver and
/// return it in the same `HierarchyTree` shape the CLI path produces,
/// so callers can drop-in swap between the two implementations.
///
/// Expects `studio::StudioKeeper::start` to have completed recently —
/// i.e. the driver is up, listening, and the adb forward is in place.
pub async fn dump_hierarchy() -> AppResult<HierarchyTree> {
    let overall_start = Instant::now();
    let mut client = connect().await?;
    let connect_ms = overall_start.elapsed().as_millis();

    let rpc_start = Instant::now();
    let response = client
        .view_hierarchy(Request::new(ViewHierarchyRequest {}))
        .await
        .map_err(|status| {
            AppError::HierarchyParse(format!(
                "viewHierarchy RPC failed: {} ({})",
                status.message(),
                status.code(),
            ))
        })?;
    let rpc_ms = rpc_start.elapsed().as_millis();

    // The driver emits UiAutomator-format XML (see ViewHierarchy.kt in
    // maestro-android). Our existing `parse_xml` already handles that
    // format including the Compose/RN `accessibilityText` fallback.
    let xml = response.into_inner().hierarchy;
    let parse_start = Instant::now();
    let mut tree = parse_xml(&xml)?;
    tree.xml_raw = xml;
    let parse_ms = parse_start.elapsed().as_millis();

    info!(
        connect_ms,
        rpc_ms,
        parse_ms,
        total_ms = overall_start.elapsed().as_millis(),
        bytes = tree.xml_raw.len(),
        "hierarchy dump via gRPC complete"
    );
    debug!(
        has_root = tree.root.is_some(),
        "gRPC dump parsed into UINode tree"
    );

    if tree.root.is_none() || tree.xml_raw.len() < MIN_VALID_HIERARCHY_BYTES {
        return Err(AppError::StaleDriver(format!(
            "bytes={}, has_root={}",
            tree.xml_raw.len(),
            tree.root.is_some()
        )));
    }

    Ok(tree)
}
