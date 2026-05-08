//! BYOK credential storage backed by the OS keychain.
//!
//! - macOS: Keychain Services (the user can audit/revoke entries via the
//!   Keychain Access.app under the service name `com.maestro-deck.chat`).
//! - Windows: Credential Manager (entries scoped to the current user via
//!   DPAPI).
//! - Linux: Secret Service (gnome-keyring / kwallet).
//!
//! Values are stored as opaque JSON strings — the layout matches the JS
//! `AnthropicCredentials` / `VertexCredentials` types. The keychain handles
//! encryption-at-rest and per-user scoping; we never write credentials to a
//! file under our control.

use keyring::Entry;

const SERVICE: &str = "com.maestro-deck.chat";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| format!("keyring open failed: {e}"))
}

fn validate_provider(provider: &str) -> Result<&'static str, String> {
    match provider {
        "anthropic" => Ok("anthropic"),
        "vertex" => Ok("vertex"),
        other => Err(format!("unknown provider: {other}")),
    }
}

#[tauri::command]
pub async fn save_credential(provider: String, payload: String) -> Result<(), String> {
    let account = validate_provider(&provider)?;
    entry(account)?
        .set_password(&payload)
        .map_err(|err| format!("keyring write failed: {err}"))
}

#[tauri::command]
pub async fn get_credential(provider: String) -> Result<Option<String>, String> {
    let account = validate_provider(&provider)?;
    match entry(account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("keyring read failed: {err}")),
    }
}

#[tauri::command]
pub async fn delete_credential(provider: String) -> Result<(), String> {
    let account = validate_provider(&provider)?;
    match entry(account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("keyring delete failed: {err}")),
    }
}
