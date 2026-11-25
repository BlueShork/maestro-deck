// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Audit on real captures (hierarchy + screenshot) taken from devices.
//! See `fixtures/README.md` for where each capture comes from.

use super::*;
use crate::hierarchy::ios::parse_ios_axelement;

fn ios_screen(name: &str) -> Screen {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src/a11y/fixtures/ios/");
    let json = std::fs::read_to_string(format!("{dir}{name}.json")).expect("fixture json");
    let png = image::open(format!("{dir}{name}.png"))
        .expect("fixture png")
        .to_rgba8();
    // iPhone 17 Pro: 402 × 874 pt.
    let root = parse_ios_axelement(&json, Some((402, 874)))
        .expect("parse")
        .root
        .expect("root");
    Screen {
        name: name.into(),
        root,
        screenshot: Some(png),
    }
}

fn ios_config() -> AuditConfig {
    AuditConfig {
        platform: Platform::Ios,
        px_per_unit: Some(1.0),
    }
}

fn criterion<'a>(r: &'a AccessibilityReport, id: &str) -> &'a CriterionResult {
    r.criteria
        .iter()
        .chain(r.best_practices.iter())
        .find(|c| c.id == id)
        .expect("criterion")
}

#[test]
fn ios_settings_text_size_switches_expose_their_state() {
    let r = audit(&[ios_screen("settings-display-text-size")], &ios_config());
    let r3 = criterion(&r, "R3");
    assert_eq!(r3.status, CriterionStatus::Passed, "{:#?}", r3.failures);
}

#[test]
fn ios_settings_nested_unlabeled_switches_are_not_flagged() {
    // Each row "Texte en gras", "Afficher les bordures"… contains an inner
    // switch control with an empty label: VoiceOver reads the row, so R1 must
    // not report the inner control.
    let r = audit(&[ios_screen("settings-display-text-size")], &ios_config());
    let r1 = criterion(&r, "R1");
    assert!(
        r1.failures.iter().all(|f| !f.element.starts_with("Switch")),
        "{:#?}",
        r1.failures
    );
}

#[test]
fn ios_settings_switch_size_is_review_not_failure() {
    let r = audit(&[ios_screen("settings-display-text-size")], &ios_config());
    let b1 = criterion(&r, "B1");
    assert!(
        b1.failures.is_empty(),
        "iOS sizes are review-only: {:#?}",
        b1.failures
    );
}

#[test]
fn ios_containers_are_not_checked_for_contrast() {
    for name in ["settings-home", "settings-display-text-size"] {
        let r = audit(&[ios_screen(name)], &ios_config());
        let r4 = criterion(&r, "R4");
        assert!(
            r4.failures
                .iter()
                .all(|f| !f.element.starts_with("Application")),
            "{name}: {:#?}",
            r4.failures
        );
    }
}

#[test]
fn ios_elements_cut_by_screen_edge_are_not_size_checked() {
    let r = audit(&[ios_screen("settings-home")], &ios_config());
    let b1 = criterion(&r, "B1");
    assert!(
        b1.failures.iter().all(|f| !f.element.contains("Code")),
        "{:#?}",
        b1.failures
    );
}

#[test]
fn ios_contrast_only_checks_visible_text() {
    // Icons ("chevron") and switches carry a VoiceOver label in `text`.
    let r = audit(&[ios_screen("settings-display-text-size")], &ios_config());
    let r4 = criterion(&r, "R4");
    assert!(r4
        .failures
        .iter()
        .chain(r4.to_review.iter())
        .all(|f| f.element.starts_with("StaticText")));
}

#[test]
fn ios_secondary_grey_text_fails_contrast() {
    // iOS secondary label grey (#8A8A8E) on white is ≈ 3.4:1, below 4.5:1.
    let r = audit(&[ios_screen("settings-display-text-size")], &ios_config());
    let r4 = criterion(&r, "R4");
    assert!(
        r4.failures
            .iter()
            .any(|f| f.element == "StaticText « Non »"),
        "{:#?}",
        r4.failures
    );
}

#[test]
fn ios_settings_home_search_field_has_a_name() {
    let r = audit(&[ios_screen("settings-home")], &ios_config());
    let r1 = criterion(&r, "R1");
    assert!(r1
        .failures
        .iter()
        .all(|f| !f.element.starts_with("SearchField")));
}

/// Prints the full report for a manual look: `cargo test --lib
/// a11y::fixtures_test::print_reports -- --ignored --nocapture`.
#[test]
#[ignore]
fn print_reports() {
    for name in ["settings-home", "settings-display-text-size"] {
        let r = audit(&[ios_screen(name)], &ios_config());
        println!("== {name}: score {:?}, verdict {:?}", r.score, r.verdict);
        for c in r.criteria.iter().chain(r.best_practices.iter()) {
            println!(
                "  {} {:?} — {} échec(s), {} à vérifier",
                c.id,
                c.status,
                c.failures.len(),
                c.to_review.len()
            );
            for f in c.failures.iter().chain(c.to_review.iter()).take(4) {
                println!(
                    "     - {} : {}{}",
                    f.element,
                    f.message,
                    if f.needs_review {
                        " (à vérifier)"
                    } else {
                        ""
                    }
                );
            }
        }
    }
}
