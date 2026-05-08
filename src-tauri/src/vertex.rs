//! Vertex AI OAuth2 access-token exchange.
//!
//! Vertex requires a signed JWT (RS256) generated from a service account's
//! private key, exchanged at `https://oauth2.googleapis.com/token` for a
//! short-lived (~1h) access token. We do this in Rust so the private key
//! goes through well-vetted RS256 signing (`jsonwebtoken`) instead of
//! WebCrypto in the renderer.

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Deserialize)]
struct ServiceAccount {
    client_email: String,
    private_key: String,
    token_uri: String,
}

#[derive(Serialize)]
struct Claims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    exp: u64,
    iat: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
}

#[tauri::command]
pub async fn vertex_get_access_token(
    service_account_json: String,
) -> Result<(String, u64), String> {
    let sa: ServiceAccount = serde_json::from_str(&service_account_json)
        .map_err(|e| format!("invalid service account JSON: {e}"))?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let claims = Claims {
        iss: &sa.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: &sa.token_uri,
        exp: now + 3600,
        iat: now,
    };

    let mut header = Header::new(Algorithm::RS256);
    header.typ = Some("JWT".into());

    let key = EncodingKey::from_rsa_pem(sa.private_key.as_bytes())
        .map_err(|e| format!("invalid private key: {e}"))?;

    let assertion = encode(&header, &claims, &key)
        .map_err(|e| format!("jwt encode: {e}"))?;

    let resp = reqwest::Client::new()
        .post(&sa.token_uri)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", &assertion),
        ])
        .send()
        .await
        .map_err(|e| format!("token request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("token endpoint {status}: {body}"));
    }

    let token: TokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("token response decode: {e}"))?;

    Ok((token.access_token, token.expires_in))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_invalid_json() {
        let err = vertex_get_access_token("not-json".into()).await.unwrap_err();
        assert!(err.contains("invalid service account JSON"), "got: {err}");
    }

    #[tokio::test]
    async fn rejects_invalid_private_key() {
        let bad = serde_json::json!({
            "client_email": "test@example.iam.gserviceaccount.com",
            "private_key": "-----BEGIN PRIVATE KEY-----\nnot-real\n-----END PRIVATE KEY-----\n",
            "token_uri": "https://oauth2.googleapis.com/token"
        })
        .to_string();
        let err = vertex_get_access_token(bad).await.unwrap_err();
        assert!(err.contains("invalid private key"), "got: {err}");
    }
}
