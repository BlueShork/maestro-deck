// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! On macOS a `.app` launched from Finder inherits a minimal PATH that does
//! not include Homebrew, the user's `~/.zshrc` additions, or Android SDK
//! tools. We ask the user's login shell for its PATH + JAVA_HOME and merge
//! them into our own env before Tauri starts handling commands.

#[cfg(target_os = "macos")]
pub fn enrich_from_login_shell() {
    use std::process::Command;
    use std::time::Duration;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());

    // Delimited output so we can extract PATH and JAVA_HOME even if the shell
    // rc files print banners or random noise to stdout.
    let script = r#"
printf '__PATH_START__%s__PATH_END__' "$PATH"
printf '__JAVA_START__%s__JAVA_END__' "${JAVA_HOME:-}"
"#;

    // -i: interactive (reads ~/.zshrc / ~/.bashrc)
    // -l: login shell (reads ~/.zprofile / ~/.bash_profile)
    // -c: run the script and exit
    let child = Command::new(&shell)
        .args(["-ilc", script])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn();

    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "cannot spawn login shell for PATH lookup");
            return;
        }
    };

    // Don't hang the whole app if the user's rc files do something weird.
    let deadline = std::time::Instant::now() + Duration::from_millis(1500);
    let output = loop {
        match child.try_wait() {
            Ok(Some(_status)) => break child.wait_with_output(),
            Ok(None) if std::time::Instant::now() >= deadline => {
                let _ = child.kill();
                tracing::warn!("login shell PATH lookup timed out");
                return;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => {
                tracing::warn!(error = %e, "shell wait failed");
                return;
            }
        }
    };

    let out = match output {
        Ok(o) => o,
        Err(e) => {
            tracing::warn!(error = %e, "shell output read failed");
            return;
        }
    };

    let stdout = String::from_utf8_lossy(&out.stdout);

    if let Some(path) = between(&stdout, "__PATH_START__", "__PATH_END__") {
        if !path.is_empty() {
            std::env::set_var("PATH", path);
            tracing::info!("PATH enriched from login shell");
        }
    }
    if let Some(java_home) = between(&stdout, "__JAVA_START__", "__JAVA_END__") {
        if !java_home.is_empty() {
            std::env::set_var("JAVA_HOME", java_home);
            tracing::info!(java_home, "JAVA_HOME enriched from login shell");
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn enrich_from_login_shell() {}

#[cfg(target_os = "macos")]
fn between<'a>(haystack: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let s = haystack.find(start)? + start.len();
    let e = haystack[s..].find(end)? + s;
    Some(&haystack[s..e])
}
