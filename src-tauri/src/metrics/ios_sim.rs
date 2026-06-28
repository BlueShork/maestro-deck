// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! iOS simulator metrics. A simulated app runs as a host macOS process, so its
//! CPU% and resident memory are readable with `ps`. Collection commands live in
//! the collector loop (mod.rs); the pure `ps` parser lives here for testing.

/// Parse `ps -o %cpu=,rss= -p <pid>` output → (cpu_pct, mem_mb).
/// macOS reports RSS in KiB. Returns None if the line can't be parsed (e.g. the
/// process has exited and ps printed nothing).
pub fn parse_ps_cpu_rss(s: &str) -> Option<(f32, f32)> {
    let line = s.lines().map(str::trim).find(|l| !l.is_empty())?;
    let mut cols = line.split_whitespace();
    let cpu: f32 = cols.next()?.parse().ok()?;
    let rss_kib: f32 = cols.next()?.parse().ok()?;
    Some((cpu, rss_kib / 1024.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cpu_and_rss() {
        let (cpu, mem) = parse_ps_cpu_rss(" 12.5 204800\n").expect("should parse");
        assert!((cpu - 12.5).abs() < 0.01, "cpu {cpu}");
        assert!((mem - 200.0).abs() < 0.01, "mem {mem}");
    }

    #[test]
    fn none_on_empty() {
        assert_eq!(parse_ps_cpu_rss("\n  \n"), None);
    }

    #[test]
    fn none_on_garbage() {
        assert_eq!(parse_ps_cpu_rss("not numbers here"), None);
    }
}
