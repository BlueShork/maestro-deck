//! BYOK credential storage backed by the OS keychain.
//!
//! - macOS: Keychain Services (the user can audit/revoke entries via the
//!   Keychain Access.app under the service name `com.maestro-deck.chat`).
//! - Windows: Credential Manager (entries scoped to the current user via
//!   DPAPI). Windows enforces a 2560 UTF-16 char limit per entry, which is
//!   smaller than a typical GCP service-account JSON (~2.5 KB). We work
//!   around it by chunking large payloads across multiple entries — see
//!   the `windows` helpers below.
//! - Linux: Secret Service (gnome-keyring / kwallet).
//!
//! Values are stored as opaque JSON strings — the layout matches the JS
//! `AnthropicCredentials` / `VertexCredentials` types. The keychain handles
//! encryption-at-rest and per-user scoping; we never write credentials to a
//! file under our control.

use keyring::Entry;

const SERVICE: &str = "com.maestro-deck.chat";

/// Stay well under the Windows Credential Manager limit (2560 UTF-16
/// chars). 1500 ASCII chars = 1500 UTF-16 code units; multibyte JSON
/// (e.g. account names with accents) still leaves comfortable headroom.
#[cfg(target_os = "windows")]
const CHUNK_SIZE: usize = 1500;

/// Marker prefix used in the primary entry to indicate the value is
/// stored across N chunked entries. Format: `"__CHUNKED__:<N>"`.
#[cfg(target_os = "windows")]
const CHUNK_MARKER: &str = "__CHUNKED__:";

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
    write_payload(account, &payload)
}

#[tauri::command]
pub async fn get_credential(provider: String) -> Result<Option<String>, String> {
    let account = validate_provider(&provider)?;
    read_payload(account)
}

#[tauri::command]
pub async fn delete_credential(provider: String) -> Result<(), String> {
    let account = validate_provider(&provider)?;
    delete_payload(account)
}

// ---------------------------------------------------------------------------
// Non-Windows: single-entry passthrough (macOS Keychain / Linux Secret Service
// have no payload-size limit we'd run into).
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "windows"))]
fn write_payload(account: &str, payload: &str) -> Result<(), String> {
    entry(account)?
        .set_password(payload)
        .map_err(|err| format!("keyring write failed: {err}"))
}

#[cfg(not(target_os = "windows"))]
fn read_payload(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("keyring read failed: {err}")),
    }
}

#[cfg(not(target_os = "windows"))]
fn delete_payload(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("keyring delete failed: {err}")),
    }
}

// ---------------------------------------------------------------------------
// Windows: chunk payloads larger than CHUNK_SIZE into `<account>__0`,
// `<account>__1`, ... and store `__CHUNKED__:<N>` in the primary entry as
// a discriminator. Small payloads still go in the primary entry directly,
// so anthropic API keys keep their pre-existing layout.
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn chunk_account(account: &str, idx: usize) -> String {
    format!("{account}__{idx}")
}

#[cfg(target_os = "windows")]
fn write_payload(account: &str, payload: &str) -> Result<(), String> {
    // Always clear any previous chunks for this account, otherwise switching
    // from a large payload back to a small one would leave stale chunks
    // behind that could re-surface on a future read.
    delete_chunks(account);

    if payload.len() <= CHUNK_SIZE {
        return entry(account)?
            .set_password(payload)
            .map_err(|err| format!("keyring write failed: {err}"));
    }

    // Split on UTF-8 char boundaries so each chunk is itself valid UTF-8
    // even if the JSON contains non-ASCII (account names with accents,
    // emojis in keys, etc.).
    let chunks = split_on_char_boundary(payload, CHUNK_SIZE);

    for (i, chunk) in chunks.iter().enumerate() {
        entry(&chunk_account(account, i))?
            .set_password(chunk)
            .map_err(|err| format!("keyring write failed (chunk {i}): {err}"))?;
    }

    let marker = format!("{CHUNK_MARKER}{}", chunks.len());
    entry(account)?
        .set_password(&marker)
        .map_err(|err| format!("keyring write failed (marker): {err}"))
}

/// Split `s` into contiguous slices of at most `max_bytes` bytes each,
/// always cutting on a UTF-8 char boundary so each chunk is itself valid
/// UTF-8.
#[cfg(target_os = "windows")]
fn split_on_char_boundary(s: &str, max_bytes: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::with_capacity(max_bytes);
    for ch in s.chars() {
        if current.len() + ch.len_utf8() > max_bytes {
            out.push(std::mem::take(&mut current));
        }
        current.push(ch);
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

#[cfg(target_os = "windows")]
fn read_payload(account: &str) -> Result<Option<String>, String> {
    let primary = match entry(account)?.get_password() {
        Ok(v) => v,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(err) => return Err(format!("keyring read failed: {err}")),
    };

    let Some(count_str) = primary.strip_prefix(CHUNK_MARKER) else {
        // Small payload stored inline.
        return Ok(Some(primary));
    };
    let count: usize = count_str
        .parse()
        .map_err(|_| format!("malformed chunk marker: {primary}"))?;

    let mut out = String::new();
    for i in 0..count {
        let chunk = entry(&chunk_account(account, i))?
            .get_password()
            .map_err(|err| format!("keyring read failed (chunk {i}): {err}"))?;
        out.push_str(&chunk);
    }
    Ok(Some(out))
}

#[cfg(target_os = "windows")]
fn delete_payload(account: &str) -> Result<(), String> {
    delete_chunks(account);
    match entry(account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("keyring delete failed: {err}")),
    }
}

/// Best-effort cleanup: walk `<account>__0`, `<account>__1`, ... and
/// delete each until we hit a `NoEntry`. Errors are intentionally
/// swallowed because a partial cleanup is still preferable to refusing
/// to delete the primary entry.
#[cfg(target_os = "windows")]
fn delete_chunks(account: &str) {
    for i in 0..usize::MAX {
        match entry(&chunk_account(account, i)) {
            Ok(e) => match e.delete_credential() {
                Ok(()) => continue,
                Err(keyring::Error::NoEntry) => break,
                Err(_) => break,
            },
            Err(_) => break,
        }
    }
}
