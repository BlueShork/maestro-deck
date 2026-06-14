// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

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

    let assertion = encode(&header, &claims, &key).map_err(|e| format!("jwt encode: {e}"))?;

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
        let err = vertex_get_access_token("not-json".into())
            .await
            .unwrap_err();
        assert!(err.contains("invalid service account JSON"), "got: {err}");
    }

    /// Regression test for the jsonwebtoken 9→10 bump: v10 ships NO crypto
    /// backend by default, so RS256 signing compiles but PANICS at runtime
    /// (which, with `panic = "abort"` in release, aborted the whole app the
    /// moment Billy asked for a Vertex token). This signs with a real
    /// (throwaway, test-only) RSA key so the actual signer path runs; it must
    /// get past signing and fail later at the network/token-endpoint stage —
    /// never panic.
    #[tokio::test]
    async fn signs_jwt_with_valid_rsa_key_without_panicking() {
        // Throwaway 2048-bit RSA key generated for this test only — NOT a secret.
        const TEST_ONLY_RSA_KEY: &str = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC74VqFMULY95Rq\n1gq57tNHC/G+2osxN8qZKp75no1lOG7Yz8aRDgk4D9K6QbfzZjBUxXqRHGQ7cqwf\nSdLKLpc9LTTiZzAoDnAFXzh8gWeicKMNR/IVACWP12G1sVnNU0mMFEJ8faNaS16P\nr96WHBbHRFweyNzZRzSiVlZP9e0O8z5zeB6PNUe9wxPIVto+akhLSN1zbWsHU2w1\nj0bbfjw/j6toX3KeJT7KC43hXPdiFo63c9c9U8acD8ziOUjFDFuZDKUeQXSrzfTq\n4u/WmaS8Z9UzQ9gZQ0NmaVj61hZZCpgX/tguGQNR+vLgRtHf1sOhF0qx7MPKtIiv\ncnaFw5sxAgMBAAECggEAIGf2XRLqHNJXXzYcE4YGGzMMN4cqiwq8fz7CvPuEF/lr\n5SmxbkOlg233Qvki6XCu1XBae70R7M8SsTLikM0IeRzbClISFFapK8QI0jDf1zzm\nYtwN/WFRGUZlLBmzC59aCDdWYHKrQl/Np6sGEY42v5gi64xpy3Bku7t4l8IraXBv\nmCsT8Gv0659tlHW+JgBuWFsBb4lYvPa1Mc2f7o0xeqEh2a6Y783acDU0YtXljk2b\nAL3nyVAnDrUoDvOPXjmuSeJu/+Rf6LFBXpXeI8eycEr8wx6QncQW0cnCn3C/M43+\ntG7riYPG8zN/r9RM2Z40+yzTFfGoxKwcsukKrwgyIQKBgQDjhg76lbW8++1XT4s6\nlMYMi6KDun2y2FzOw1qQvBP4/oQStCyGF0NMrT3iBXkj2VTLEcH5v7ov8q5kJcHM\nERRgMXsG7DUN4DuG3mtCRnRlO5JG6UTRzn2xcSAur3Tbb/S/hH6qFGMwcxb/Jb0j\nCl/aOQN28lalH+3khhWQhg654wKBgQDTZRtS0dLC7k4wsrIzPD5+8lkhI2d4RFrB\nfQM2HmSlRg8eWOBuGmLkNLoAGrS2RRtqi/KIWy2ZlhSec7vT/SO5YE4zbk2hBMv/\nLF8cxF9yDR8t8mnVRtxLWRmY9w6lKaWlytAULr33T1gzbUReQhmjcRhlWaig+DVO\n2bJ3qWby2wKBgQC9GHnygeKdwrOrUQziDyva2WKkIKa/sVrQ7UOj7uyakM2rzdsD\nRupEG+fGpc3coY/7hjK1I0fW+dc+nLLIq5lHqVgalM4zTh2rJcf3OR8b07rq/IyZ\n4whMJT0eD+0LQ60iTzgGmxMk/UIrpG3hZYnskF30ycyBSFwrBdV+XCx5CQKBgGax\nXkWscqOJmuhjVtg28vE+j/feOByfsCsArPe0ahYz45JNgLFcFiBgUN9OGe3VwozO\n8YI2MP/Efb2/4UYJWjpqw3KOqh2HtAYBKy9RYkCIiVYLxkf6hXgBD8NUeYPYqITS\n8qRrVJN4sxNAiI71s3jHrx9FH/sauOLWNLGW1NEzAoGAG4BSAQuMJeyP4Cr86v/R\nKEWnp5aEQmyl1oPivYxQiRwTzD1fegnEzatW78PNL57IkDjgvsIrLVa7inf2IWZ8\nH92x2sU/S7bhF0p4uTIHz8hvbWnBQoaDOSfdQBUqSnb1M5xMztU38nYHLw4Z1wik\nM0dNGF8F2uTEpvemUaGts+0=\n-----END PRIVATE KEY-----\n";

        let sa = serde_json::json!({
            "client_email": "test@example.iam.gserviceaccount.com",
            "private_key": TEST_ONLY_RSA_KEY,
            // Closed local port — connection refused instantly, no timeout wait.
            "token_uri": "https://127.0.0.1:1/token"
        })
        .to_string();

        let err = vertex_get_access_token(sa).await.unwrap_err();
        // Signing must succeed; the failure must come from the token request,
        // proving the RS256 signer is actually installed (no runtime panic).
        assert!(
            err.contains("token request failed"),
            "expected a network-stage error (signing OK), got: {err}"
        );
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
