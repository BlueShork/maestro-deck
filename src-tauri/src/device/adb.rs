//! ADB binary wrapper. Stub — agent fills in.
use crate::error::AppResult;
use super::Device;

pub fn list_devices() -> AppResult<Vec<Device>> {
    Ok(vec![])
}

pub fn get_device_info(_serial: &str) -> AppResult<Device> {
    Err(crate::error::AppError::NoDevice)
}

pub fn exec_shell(_serial: &str, _cmd: &str) -> AppResult<String> {
    Ok(String::new())
}
