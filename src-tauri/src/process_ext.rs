// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Windows-only ergonomics for subprocess spawning.
//!
//! On Windows, every `Command::new(...)` that runs a console app flashes
//! a `conhost.exe` window. The `CREATE_NO_WINDOW` flag suppresses that.
//! The trait is no-op on Unix so call sites stay portable.

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub trait CommandExtNoWindow {
    fn no_window(&mut self) -> &mut Self;
}

impl CommandExtNoWindow for std::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

impl CommandExtNoWindow for tokio::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

/// Runs blocking work (subprocesses, filesystem walks, tool resolution that may
/// spawn a login shell) on tokio's blocking pool.
///
/// Tauri executes a non-`async` command inline on the main thread, so any of
/// that work in a sync command freezes the window for its whole duration.
pub async fn blocking<T, F>(f: F) -> crate::error::AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| crate::error::AppError::Other(format!("background task failed: {e}")))
}

/// Read `reader` line by line until EOF, handing each line (without its
/// `\n` / `\r\n`) to `sink`.
///
/// Bytes that aren't valid UTF-8 are replaced rather than ending the loop:
/// `AsyncBufReadExt::lines` errors out on them, which silently stopped
/// draining the pipe — and a child blocked on a full stdout pipe never exits.
pub async fn pump_lines<R, F>(reader: R, mut sink: F)
where
    R: tokio::io::AsyncRead + Unpin,
    F: FnMut(String),
{
    use tokio::io::AsyncBufReadExt;
    let mut reader = tokio::io::BufReader::new(reader);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                if buf.last() == Some(&b'\n') {
                    buf.pop();
                    if buf.last() == Some(&b'\r') {
                        buf.pop();
                    }
                }
                sink(String::from_utf8_lossy(&buf).into_owned());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn blocking_runs_off_the_calling_thread_and_returns_the_value() {
        let caller = std::thread::current().id();
        let (value, ran_on) = blocking(|| (42, std::thread::current().id()))
            .await
            .unwrap();
        assert_eq!(value, 42);
        assert_ne!(ran_on, caller);
    }

    #[tokio::test]
    async fn blocking_reports_a_panic_as_an_error() {
        let res: crate::error::AppResult<()> = blocking(|| panic!("boom")).await;
        assert!(
            matches!(res, Err(crate::error::AppError::Other(m)) if m.contains("background task failed"))
        );
    }

    async fn collect(input: &[u8]) -> Vec<String> {
        let mut out = Vec::new();
        pump_lines(input, |l| out.push(l)).await;
        out
    }

    #[tokio::test]
    async fn invalid_utf8_is_replaced_and_reading_continues() {
        let lines = collect(b"ok\n\xff\xfebad\nafter\n").await;
        assert_eq!(lines, vec!["ok", "\u{FFFD}\u{FFFD}bad", "after"]);
    }

    #[tokio::test]
    async fn strips_lf_and_crlf_and_keeps_a_final_unterminated_line() {
        let lines = collect(b"a\r\nb\n\nc").await;
        assert_eq!(lines, vec!["a", "b", "", "c"]);
    }

    #[tokio::test]
    async fn empty_input_yields_nothing() {
        assert!(collect(b"").await.is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn drains_a_child_that_writes_more_than_a_pipe_buffer() {
        // 256 KiB of output with invalid bytes sprinkled in: a reader that
        // stops at the first bad byte leaves the child blocked forever.
        let mut cmd = tokio::process::Command::new("sh");
        cmd.args([
            "-c",
            r"i=0; while [ $i -lt 4096 ]; do printf 'line %d \377 padding padding padding padding\n' $i; i=$((i+1)); done",
        ])
        .stdout(std::process::Stdio::piped());
        let mut child = cmd.spawn().unwrap();
        let stdout = child.stdout.take().unwrap();
        let mut count = 0usize;
        let pump = pump_lines(stdout, |_| count += 1);
        tokio::time::timeout(std::time::Duration::from_secs(20), async {
            pump.await;
            child.wait().await.unwrap();
        })
        .await
        .expect("child never finished: pipe not drained");
        assert_eq!(count, 4096);
    }
}
