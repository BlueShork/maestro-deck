//! Pure parsers for /proc entries and `dumpsys` output. No I/O.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ProcStat {
    pub utime_ticks: u64,
    pub stime_ticks: u64,
    pub starttime_ticks: u64,
}

pub fn parse_proc_stat(s: &str) -> Option<ProcStat> {
    let rparen = s.rfind(')')?;
    let after = s.get(rparen + 1..)?.trim_start();
    let parts: Vec<&str> = after.split_whitespace().collect();
    // Fields after comm start at index 0 = state (field 3 in proc(5)).
    // So utime (14) is at offset 14 - 3 = 11, stime (15) at 12,
    // starttime (22) at 19.
    let utime = parts.get(11)?.parse().ok()?;
    let stime = parts.get(12)?.parse().ok()?;
    let starttime = parts.get(19)?.parse().ok()?;
    Some(ProcStat { utime_ticks: utime, stime_ticks: stime, starttime_ticks: starttime })
}

#[cfg(test)]
mod tests_stat {
    use super::*;

    #[test]
    fn parses_stat_with_parens_in_comm() {
        // comm field contains spaces and parens — the realistic case
        let input = "1234 (com.example.app) S 1 1234 1234 0 -1 4194304 \
                     100 0 0 0 550 120 0 0 20 0 14 0 9876543 \
                     0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0";
        let r = parse_proc_stat(input).expect("should parse");
        assert_eq!(r.utime_ticks, 550);
        assert_eq!(r.stime_ticks, 120);
        assert_eq!(r.starttime_ticks, 9876543);
    }

    #[test]
    fn returns_none_on_garbage() {
        assert!(parse_proc_stat("not a stat line").is_none());
    }

    #[test]
    fn returns_none_when_too_short() {
        assert!(parse_proc_stat("1 (x) S 2 3").is_none());
    }
}
