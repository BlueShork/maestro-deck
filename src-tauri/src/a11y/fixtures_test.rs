// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Audit on real captures (hierarchy + screenshot) taken from devices.
//! See `fixtures/README.md` for where each capture comes from. The iOS tests
//! are at the top, the Android ones (MD-40) in `mod android` below.

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

/// Android captures from an emulator (MD-40). We wrote the `a11y-bad-app`
/// screens ourselves so we know what each rule should find. Settings, Clock
/// and Wikipedia are real apps, used for the cases that pass and to spot
/// false positives.
mod android {
    use std::path::PathBuf;

    use crate::a11y::*;
    use crate::hierarchy::parse_maestro_json;

    /// Pixel 7 profile of the capture emulator: 420 dpi = 2.625 px per dp.
    const PX_PER_DP: f32 = 2.625;

    /// Every captured screen, as `<app>/<screen>`.
    const FIXTURES: &[&str] = &[
        "sample-app/signin",
        "sample-app/welcome",
        "a11y-bad-app/home",
        "a11y-bad-app/form",
        "a11y-bad-app/list",
        "a11y-bad-app/toggles",
        "a11y-bad-app/account",
        "settings/home",
        "settings/display",
        "settings/accessibility",
        "clock/alarms",
        "wikipedia/onboarding",
        "wikipedia/interests",
        "wikipedia/explore",
        "wikipedia/widget-dialog",
        "wikipedia/search-results",
        "wikipedia/article",
        "wikipedia/settings",
    ];

    fn path(fixture: &str, ext: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/a11y/fixtures/android")
            .join(format!("{fixture}.{ext}"))
    }

    fn load(fixture: &str) -> Screen {
        let raw = std::fs::read_to_string(path(fixture, "json"))
            .unwrap_or_else(|e| panic!("{fixture}.json: {e}"));
        let root = parse_maestro_json(&raw)
            .unwrap_or_else(|e| panic!("{fixture}: {e}"))
            .root
            .unwrap_or_else(|| panic!("{fixture}: empty hierarchy"));
        let screenshot = image::open(path(fixture, "png"))
            .unwrap_or_else(|e| panic!("{fixture}.png: {e}"))
            .to_rgba8();
        Screen {
            name: fixture.into(),
            root,
            screenshot: Some(screenshot),
        }
    }

    fn config() -> AuditConfig {
        AuditConfig {
            platform: Platform::Android,
            px_per_unit: Some(PX_PER_DP),
        }
    }

    fn audit_one(fixture: &str) -> AccessibilityReport {
        audit(&[load(fixture)], &config())
    }

    fn result<'a>(report: &'a AccessibilityReport, id: &str) -> &'a CriterionResult {
        report
            .criteria
            .iter()
            .chain(report.best_practices.iter())
            .find(|c| c.id == id)
            .unwrap_or_else(|| panic!("no criterion {id}"))
    }

    /// Top-left corners of the failing elements, to match them against the
    /// bounds in the fixture JSON.
    fn failing(report: &AccessibilityReport, id: &str) -> Vec<[i32; 2]> {
        let mut v: Vec<_> = result(report, id)
            .failures
            .iter()
            .map(|f| [f.bounds[0], f.bounds[1]])
            .collect();
        v.sort();
        v
    }

    /// Failures plus "à vérifier" findings.
    fn flagged(report: &AccessibilityReport, id: &str) -> Vec<[i32; 2]> {
        let c = result(report, id);
        let mut v: Vec<_> = c
            .failures
            .iter()
            .chain(c.to_review.iter())
            .map(|f| [f.bounds[0], f.bounds[1]])
            .collect();
        v.sort();
        v
    }

    fn assert_passes(fixture: &str, id: &str) {
        let r = audit_one(fixture);
        let c = result(&r, id);
        assert_eq!(
            c.status,
            CriterionStatus::Passed,
            "{fixture} {id}: {:?}",
            c.failures
        );
    }

    #[test]
    fn every_fixture_parses_with_its_screenshot() {
        for fixture in FIXTURES {
            let s = load(fixture);
            let shot = s.screenshot.as_ref().unwrap();
            assert_eq!(
                (shot.width(), shot.height()),
                (1080, 2400),
                "{fixture}: png size"
            );
            let mut nodes = 0;
            walk(&s.root, &mut |_| nodes += 1);
            assert!(nodes > 5, "{fixture}: only {nodes} nodes");
        }
    }

    // ---- R1: accessible name ----
    // Bounds below are copied from a11y-bad-app/account.json.

    #[test]
    fn r1_fails_on_the_three_unlabeled_elements() {
        let r = audit_one("a11y-bad-app/account");
        assert_eq!(
            failing(&r, "R1"),
            vec![
                [63, 199], // ImageButton #close, no contentDescription
                [63, 509], // EditText #name, no label nor hint
                [63, 808], // FrameLayout #avatar_card, only an unlabeled image
            ]
        );
    }

    #[test]
    fn r1_passes_on_real_screens() {
        for fixture in [
            "sample-app/signin",
            "settings/home",
            "clock/alarms",
            "wikipedia/onboarding",
            "wikipedia/search-results",
        ] {
            assert_passes(fixture, "R1");
        }
    }

    // ---- R2: duplicate or redundant labels ----

    #[test]
    fn r2_fails_on_duplicate_and_redundant_labels() {
        let r = audit_one("a11y-bad-app/account");
        assert_eq!(
            failing(&r, "R2"),
            vec![
                [63, 1039],  // Button « Supprimer »
                [63, 1165],  // contentDescription « Bouton valider » repeats the role
                [540, 1039], // the other Button « Supprimer »
            ]
        );
    }

    #[test]
    fn r2_passes_on_real_screens() {
        for fixture in [
            "sample-app/signin",
            "settings/home",
            "settings/display",
            "wikipedia/article",
            "wikipedia/settings",
        ] {
            assert_passes(fixture, "R2");
        }
    }

    // ---- R3: toggle state exposed ----

    #[test]
    fn r3_passes_on_real_switches() {
        // Wikipedia interests screen, the correct switches and checkboxes of
        // the bad app.
        for fixture in [
            "wikipedia/interests",
            "a11y-bad-app/form",
            "a11y-bad-app/toggles",
        ] {
            assert_passes(fixture, "R3");
        }
        let r = audit_one("a11y-bad-app/account");
        assert!(
            !failing(&r, "R3").contains(&[63, 1480]),
            "Newsletter is fine"
        );
    }

    /// Ground truth: #notif_broken declares itself not checkable, so TalkBack
    /// never reads its state. `maestro hierarchy` doesn't export `checkable` and
    /// always fills `checked`, so R3 can't see it from a Maestro dump. Kept as
    /// the expected result. See the README ("Problèmes trouvés") and MD-38.
    #[test]
    #[ignore = "R3 can't detect it from Maestro JSON (no `checkable`), see fixtures/README.md"]
    fn r3_fails_on_the_switch_that_hides_its_state() {
        let r = audit_one("a11y-bad-app/account");
        assert_eq!(failing(&r, "R3"), vec![[63, 1333]]);
    }

    // ---- R4: text contrast ----

    #[test]
    fn r4_fails_on_light_grey_text() {
        let r = audit_one("a11y-bad-app/account");
        assert!(
            flagged(&r, "R4").contains(&[63, 1669]),
            "#BDBDBD on white, about 1.9:1"
        );
    }

    #[test]
    fn r4_passes_on_dark_text() {
        let r = audit_one("a11y-bad-app/account");
        assert!(!flagged(&r, "R4").contains(&[63, 1747]), "#212121 on white");
        for fixture in ["settings/home", "settings/accessibility", "clock/alarms"] {
            assert_passes(fixture, "R4");
        }
    }

    // ---- B1: touch target size (best practice) ----

    #[test]
    fn b1_fails_on_small_targets() {
        let r = audit_one("a11y-bad-app/account");
        assert_eq!(
            failing(&r, "B1"),
            vec![
                [63, 509],   // EditText #name: Android's default field is 45 dp high
                [63, 648],   // EditText #email: same
                [954, 1877], // ImageButton « Aide », 24 × 24 dp
            ]
        );
    }

    #[test]
    fn b1_passes_on_real_screens() {
        for fixture in [
            "settings/home",
            "settings/accessibility",
            "wikipedia/widget-dialog",
            "wikipedia/settings",
        ] {
            assert_passes(fixture, "B1");
        }
    }

    // ---- Real defects in a third-party app (Wikipedia) ----

    #[test]
    fn r1_fails_on_wikipedia_unlabeled_header_image() {
        // The article's lead image is clickable (opens the gallery) and has no
        // description.
        let r = audit_one("wikipedia/article");
        assert!(failing(&r, "R1").contains(&[0, 304]));
    }

    #[test]
    fn b1_fails_on_wikipedia_search_bar() {
        // Search bar of the article toolbar, 36 dp high.
        let r = audit_one("wikipedia/article");
        let f = failing(&r, "B1");
        assert!(f.contains(&[147, 172]), "{f:?}");
    }

    // ---- Ground truth on the four other a11y-bad-app screens ----
    // Each defect is commented in a11y-bad-app/res/layout/<screen>.xml.

    /// Expected failures per screen and rule (top-left corners).
    const BAD_APP_EXPECTED: &[(&str, &str, &[[i32; 2]])] = &[
        // Menu and the three icon-only tabs.
        (
            "a11y-bad-app/home",
            "R1",
            &[[0, 2169], [21, 146], [360, 2169], [720, 2169]],
        ),
        ("a11y-bad-app/home", "R2", &[]),
        ("a11y-bad-app/home", "B1", &[[933, 2022]]), // 32 dp floating button
        // Amount and reason fields. The « Bénéficiaire » field has a hint.
        ("a11y-bad-app/form", "R1", &[[63, 530], [63, 698]]),
        ("a11y-bad-app/form", "R2", &[[63, 1243], [540, 1243]]), // two « OK »
        ("a11y-bad-app/form", "R3", &[]),
        ("a11y-bad-app/form", "B1", &[[63, 1127]]), // 20 dp checkbox
        // Four unlabeled bins and four « Voir » buttons.
        (
            "a11y-bad-app/list",
            "R1",
            &[[891, 460], [891, 649], [891, 838], [891, 1027]],
        ),
        (
            "a11y-bad-app/list",
            "R2",
            &[[660, 460], [660, 649], [660, 838], [660, 1027]],
        ),
        ("a11y-bad-app/list", "B1", &[]),
        ("a11y-bad-app/toggles", "R1", &[[891, 980]]), // clickable star
        ("a11y-bad-app/toggles", "R2", &[]),
        ("a11y-bad-app/toggles", "B1", &[[63, 782]]), // 32 dp high switch
    ];

    #[test]
    fn bad_app_screens_match_their_ground_truth() {
        for (fixture, id, expected) in BAD_APP_EXPECTED {
            let r = audit_one(fixture);
            assert_eq!(failing(&r, id), expected.to_vec(), "{fixture} {id}");
        }
    }

    /// Prints the full report of every fixture. Not an assertion: run it with
    /// `cargo test --lib a11y::fixtures_test::android::print_reports -- --ignored --nocapture`.
    #[test]
    #[ignore = "prints the reports, asserts nothing"]
    fn print_reports() {
        for fixture in FIXTURES {
            let r = audit_one(fixture);
            println!("===== {fixture}: score {:?}, {:?}", r.score, r.verdict);
            for c in r.criteria.iter().chain(r.best_practices.iter()) {
                println!("  {} {:?}", c.id, c.status);
                for f in &c.failures {
                    println!("    ✗ {}: {} {:?}", f.element, f.message, f.bounds);
                }
                for f in &c.to_review {
                    println!("    ? {}: {} {:?}", f.element, f.message, f.bounds);
                }
            }
        }
    }
}
