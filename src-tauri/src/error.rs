use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error(
        "ADB not found in PATH. Install Android platform-tools or set the ADB path in Settings."
    )]
    AdbNotFound,

    #[error("No Android device connected. Plug in a device with USB debugging enabled.")]
    NoDevice,

    #[error("Device {0} not authorized. Accept the USB debugging prompt on the device.")]
    DeviceUnauthorized(String),

    #[error("ADB command failed: {0}")]
    AdbFailed(String),

    #[error("scrcpy server failed: {0}")]
    ScrcpyFailed(String),

    #[error("Video decoding error: {0}")]
    VideoDecode(String),

    #[error("UI hierarchy parse error: {0}")]
    HierarchyParse(String),

    #[error("Maestro runner not found. Install via `curl -Ls 'https://get.maestro.mobile.dev' | bash` or set the path in Settings.")]
    RunnerNotFound,

    #[error("Runner failed: {0}")]
    RunnerFailed(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Other: {0}")]
    Other(String),
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Other(e.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = std::result::Result<T, AppError>;
