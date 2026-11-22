// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Tauri commands for device-farm sessions.

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::device::{Device, Platform};
use crate::error::{AppError, AppResult};
use crate::farm::session::{ApkResult, FarmSession, Hello, SharedSink};
use crate::farm::AppFarmEvents;
use crate::scrcpy::stream::FrameSink;
use crate::state::AppState;

pub fn device_from_hello(h: &Hello) -> Device {
    let (w, h_px) = match &h.screen {
        Some(s) => (s.width, s.height),
        None => (h.video_width.unwrap_or(0), h.video_height.unwrap_or(0)),
    };
    let release = h.android_release.clone().unwrap_or_default();
    // An iPhone of the farm is driven exactly like a farm Android phone (video,
    // scrcpy input, inspect, runs all go through the gateway), so it keeps the
    // Android routing; only its OS version differs.
    let os_version = if h.platform.as_deref() == Some("ios") {
        h.os_version.clone().unwrap_or_default()
    } else {
        release.clone()
    };
    Device {
        serial: h.device_id.clone(),
        model: h.model.clone().unwrap_or_else(|| "Farm phone".into()),
        android_version: release,
        screen_width: w,
        screen_height: h_px,
        platform: Platform::Android,
        os_version,
        booted: false,
        physical: false,
    }
}

#[tauri::command]
pub async fn connect_farm_device(
    gateway_url: String,
    token: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Device> {
    crate::ipc::commands::teardown_all_sessions(state.inner(), false).await;
    let frames_app = app.clone();
    let sink = SharedSink::new(move |payload| FrameSink::emit(&frames_app, payload));
    let session =
        FarmSession::connect(&gateway_url, &token, Arc::new(AppFarmEvents(app)), sink).await?;
    let hello = session.hello().ok_or(AppError::NoDevice)?;
    let device = device_from_hello(&hello);
    *state.control_tx.lock().await = Some(session.control_sender());
    *state.farm_session.lock().await = Some(session);
    *state.connected_device.write() = Some(device.clone());
    Ok(device)
}

#[tauri::command]
pub async fn farm_reconnect(
    gateway_url: String,
    token: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let session = crate::farm::active(state.inner())
        .await
        .ok_or(AppError::NoDevice)?;
    session.reconnect(&gateway_url, &token).await
}

#[tauri::command]
pub async fn farm_install_apk(path: String, state: State<'_, AppState>) -> AppResult<ApkResult> {
    let session = crate::farm::active(state.inner())
        .await
        .ok_or(AppError::NoDevice)?;
    session.install_apk(std::path::Path::new(&path)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::farm::session::{Hello, Screen};

    #[test]
    fn a_farm_phone_looks_like_an_android_device_with_its_native_size() {
        let d = device_from_hello(&Hello {
            device_id: "nuc1-S1".into(),
            model: Some("SM-S928B".into()),
            android_release: Some("15".into()),
            screen: Some(Screen {
                width: 1080,
                height: 2340,
                density: 450,
            }),
            video_width: Some(472),
            video_height: Some(1024),
            minutes_remaining: 30.0,
            max_ends_at: 0.0,
            platform: None,
            os_version: None,
        });
        assert_eq!(d.serial, "nuc1-S1");
        assert_eq!(d.platform, crate::device::Platform::Android);
        assert_eq!((d.screen_width, d.screen_height), (1080, 2340));
        assert_eq!(d.android_version, "15");
        assert!(!d.physical);
    }

    #[test]
    fn a_farm_iphone_keeps_the_farm_routing_with_its_ios_version() {
        let hello: Hello = serde_json::from_value(serde_json::json!({
            "deviceId": "macmini1-U", "model": "iPhone 17 Pro", "androidRelease": null,
            "screen": {"width": 1206, "height": 2622, "density": 480},
            "videoWidth": 1206, "videoHeight": 2622, "minutesRemaining": 30.0, "maxEndsAt": 0.0,
            "platform": "ios", "osVersion": "26.7.2"
        }))
        .expect("hello");
        let d = device_from_hello(&hello);
        assert_eq!(d.platform, crate::device::Platform::Android);
        assert_eq!(d.os_version, "26.7.2");
        assert_eq!(d.android_version, "");
        assert_eq!((d.screen_width, d.screen_height), (1206, 2622));
    }
}
