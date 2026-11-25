// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! The audit rules. Each one is a pure function over a single screen.

use std::collections::HashMap;

use super::{
    app_nodes, contrast, finding, merged_label, own_label, screen_bounds, short_class, AuditConfig,
    Platform, RuleOutcome, Screen,
};
use crate::hierarchy::UINode;

pub struct Rule {
    pub id: &'static str,
    pub title: &'static str,
    /// RAAM 1.1 criteria covered. Empty = best practice, not scored.
    pub raam: &'static [&'static str],
    pub check: fn(&Screen, &AuditConfig) -> RuleOutcome,
}

pub fn all() -> Vec<Rule> {
    vec![
        Rule {
            id: "R1",
            title: "Les éléments interactifs et les images porteuses d'information ont un nom accessible",
            raam: &["1.2", "5.1", "9.2"],
            check: missing_name,
        },
        Rule {
            id: "R2",
            title: "Les libellés ne sont ni dupliqués ni redondants avec le rôle",
            raam: &["9.3", "9.5"],
            check: duplicate_or_redundant_label,
        },
        Rule {
            id: "R3",
            title: "L'état des interrupteurs, cases à cocher et boutons radio est exposé",
            raam: &["5.5"],
            check: toggle_state_exposed,
        },
        Rule {
            id: "R4",
            title: "Le contraste du texte est suffisant (4,5:1, ou 3:1 pour le grand texte)",
            raam: &["2.2"],
            check: contrast::text_contrast,
        },
        Rule {
            id: "B1",
            title: "Les cibles tactiles font au moins 48 dp (Android) / 44 pt (iOS)",
            raam: &[],
            check: touch_target_size,
        },
    ]
}

fn is_image(n: &UINode) -> bool {
    let c = short_class(n);
    c.contains("Image") || c == "Icon"
}

fn is_text_input(n: &UINode) -> bool {
    let c = short_class(n);
    c.contains("EditText") || c.contains("TextField") || c == "SearchField"
}

fn is_toggle(n: &UINode) -> bool {
    let c = short_class(n);
    n.a11y.checkable == Some(true)
        || [
            "Switch",
            "CheckBox",
            "RadioButton",
            "ToggleButton",
            "CompoundButton",
            "Toggle",
        ]
        .iter()
        .any(|k| c.contains(k))
}

/// R1 — RAAM 1.2 / 5.1 / 9.2.
/// Fails: a clickable element with no label (itself or merged from its
/// children), an image button with no label, an image explicitly marked
/// important for accessibility with no label, a text field with neither a
/// label nor a hint.
fn missing_name(screen: &Screen, _: &AuditConfig) -> RuleOutcome {
    let mut out = RuleOutcome::default();
    for n in app_nodes(&screen.root) {
        if !n.enabled {
            continue;
        }
        if is_text_input(n) {
            out.applicable = true;
            if own_label(n).is_none() && n.a11y.hint_text.is_none() {
                out.findings.push(finding(
                    screen,
                    n,
                    "Champ de saisie sans libellé ni indication",
                ));
            }
            continue;
        }
        let image_needs_name =
            is_image(n) && (n.clickable || n.a11y.important_for_accessibility == Some(true));
        if n.clickable || image_needs_name {
            out.applicable = true;
            if merged_label(n).is_none() {
                let msg = if is_image(n) {
                    "Image cliquable ou informative sans nom accessible"
                } else {
                    "Élément interactif sans nom accessible : le lecteur d'écran ne peut rien annoncer"
                };
                out.findings.push(finding(screen, n, msg));
            }
        }
    }
    out
}

const ROLE_WORDS: &[&str] = &[
    "bouton",
    "button",
    "btn",
    "image",
    "icône",
    "icone",
    "icon",
    "lien",
    "link",
    "case à cocher",
    "checkbox",
];

fn contains_role_word(label: &str) -> Option<&'static str> {
    let lower = label.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric() && c != 'à')
        .filter(|w| !w.is_empty())
        .collect();
    ROLE_WORDS.iter().copied().find(|role| {
        if role.contains(' ') {
            lower.contains(role)
        } else {
            words.contains(role)
        }
    })
}

/// R2 — RAAM 9.3 / 9.5 (partial).
/// Fails: two interactive elements on the same screen with the same label
/// (the user can't tell them apart), or a label repeating the role the
/// screen reader already announces ("bouton Valider").
fn duplicate_or_redundant_label(screen: &Screen, _: &AuditConfig) -> RuleOutcome {
    let mut out = RuleOutcome::default();
    let mut seen: HashMap<String, usize> = HashMap::new();
    let nodes = app_nodes(&screen.root);
    let interactive: Vec<(&UINode, String)> = nodes
        .iter()
        .filter(|n| n.clickable && n.enabled)
        .filter_map(|n| merged_label(n).map(|l| (*n, l)))
        .collect();

    for (n, label) in &interactive {
        out.applicable = true;
        *seen.entry(label.trim().to_lowercase()).or_default() += 1;
        if let Some(desc) = n.content_desc.as_deref() {
            if let Some(role) = contains_role_word(desc) {
                out.findings.push(finding(
                    screen,
                    n,
                    format!(
                        "Libellé redondant : « {role} » est déjà annoncé par le lecteur d'écran"
                    ),
                ));
            }
        }
    }
    for (n, label) in &interactive {
        if seen.get(&label.trim().to_lowercase()).copied().unwrap_or(0) > 1 {
            out.findings.push(finding(
                screen,
                n,
                format!(
                    "Libellé « {} » partagé par plusieurs éléments interactifs",
                    label.trim()
                ),
            ));
        }
    }
    out
}

/// R3 — RAAM 5.5.
/// Fails: an element that behaves as a toggle but doesn't expose its state
/// (`checkable` false, or no `checked` value at all).
fn toggle_state_exposed(screen: &Screen, _: &AuditConfig) -> RuleOutcome {
    let mut out = RuleOutcome::default();
    for n in app_nodes(&screen.root) {
        if !is_toggle(n) {
            continue;
        }
        out.applicable = true;
        let exposes_state = n.a11y.checkable != Some(false) && n.a11y.checked.is_some();
        if !exposes_state {
            out.findings.push(finding(
                screen,
                n,
                "Interrupteur ou case dont l'état (coché / non coché) n'est pas exposé",
            ));
        }
    }
    out
}

/// B1 — best practice (WCAG 2.2 2.5.8, Android / Apple guidelines).
fn touch_target_size(screen: &Screen, config: &AuditConfig) -> RuleOutcome {
    let mut out = RuleOutcome::default();
    let density = config.density(&screen.root);
    let min = match config.platform {
        Platform::Android => 48.0,
        Platform::Ios => 44.0,
    };
    let unit = match config.platform {
        Platform::Android => "dp",
        Platform::Ios => "pt",
    };
    for n in app_nodes(&screen.root) {
        if !(n.clickable && n.enabled) {
            continue;
        }
        // A sliver cut by the screen edge (scroll content clamped to the
        // screen, e.g. 370×4 pt at the bottom): its real size is unknown.
        let r = &screen_bounds(&screen.root);
        let touches_edge = n.bounds.top <= r.top || n.bounds.bottom >= r.bottom;
        if touches_edge && ((n.bounds.bottom - n.bounds.top) as f32 / density) < 8.0 {
            continue;
        }
        out.applicable = true;
        let w = (n.bounds.right - n.bounds.left) as f32 / density;
        let h = (n.bounds.bottom - n.bounds.top) as f32 / density;
        if w < min || h < min {
            let mut f = finding(
                screen,
                n,
                format!("Cible tactile de {w:.0}×{h:.0} {unit}, minimum conseillé {min:.0}×{min:.0} {unit}"),
            );
            // iOS frames are often smaller than the real hit area (a Settings
            // row's switch is 28 pt tall, the cell around it handles the
            // touch). Flag for review on iOS, never as a miss.
            f.needs_review = config.platform == Platform::Ios;
            out.findings.push(f);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::testutil::*;
    use super::*;

    fn clickable(class: &str, b: [i32; 4], text: Option<&str>) -> UINode {
        let mut n = node(class, b);
        n.clickable = true;
        n.text = text.map(String::from);
        n
    }

    // ---- R1 ----

    #[test]
    fn r1_flags_unlabeled_image_button() {
        let s = screen(root(vec![clickable(
            "android.widget.ImageButton",
            [0, 0, 200, 200],
            None,
        )]));
        let o = missing_name(&s, &android());
        assert!(o.applicable);
        assert_eq!(o.findings.len(), 1);
    }

    #[test]
    fn r1_accepts_label_merged_from_child() {
        let mut row = clickable("android.widget.LinearLayout", [0, 0, 1080, 200], None);
        let mut t = node("android.widget.TextView", [20, 20, 600, 180]);
        t.text = Some("Paramètres".into());
        row.children.push(t);
        let o = missing_name(&screen(root(vec![row])), &android());
        assert!(o.applicable);
        assert!(o.findings.is_empty());
    }

    #[test]
    fn r1_accepts_content_description() {
        let mut b = clickable("android.widget.ImageButton", [0, 0, 200, 200], None);
        b.content_desc = Some("Fermer".into());
        let o = missing_name(&screen(root(vec![b])), &android());
        assert!(o.findings.is_empty());
    }

    #[test]
    fn r1_ignores_decorative_image() {
        let img = node("android.widget.ImageView", [0, 0, 200, 200]);
        let o = missing_name(&screen(root(vec![img])), &android());
        assert!(!o.applicable);
    }

    #[test]
    fn r1_flags_text_field_without_label_or_hint() {
        let f = node("android.widget.EditText", [0, 0, 800, 150]);
        let o = missing_name(&screen(root(vec![f])), &android());
        assert_eq!(o.findings.len(), 1);
    }

    #[test]
    fn r1_accepts_text_field_with_hint() {
        let mut f = node("android.widget.EditText", [0, 0, 800, 150]);
        f.a11y.hint_text = Some("Adresse e-mail".into());
        let o = missing_name(&screen(root(vec![f])), &android());
        assert!(o.findings.is_empty());
    }

    #[test]
    fn r1_skips_system_ui_and_disabled() {
        let mut sys = clickable("android.widget.ImageView", [0, 0, 100, 100], None);
        sys.package = "com.android.systemui".into();
        let mut off = clickable("android.widget.ImageButton", [0, 200, 200, 400], None);
        off.enabled = false;
        let o = missing_name(&screen(root(vec![sys, off])), &android());
        assert!(o.findings.is_empty());
    }

    // ---- R2 ----

    #[test]
    fn r2_flags_duplicate_labels() {
        let s = screen(root(vec![
            clickable(
                "android.widget.Button",
                [0, 0, 400, 200],
                Some("En savoir plus"),
            ),
            clickable(
                "android.widget.Button",
                [0, 300, 400, 500],
                Some("en savoir plus "),
            ),
        ]));
        let o = duplicate_or_redundant_label(&s, &android());
        assert_eq!(o.findings.len(), 2);
    }

    #[test]
    fn r2_flags_role_in_content_description() {
        let mut b = clickable("android.widget.ImageButton", [0, 0, 200, 200], None);
        b.content_desc = Some("Bouton fermer".into());
        let o = duplicate_or_redundant_label(&screen(root(vec![b])), &android());
        assert_eq!(o.findings.len(), 1);
        assert!(o.findings[0].message.contains("bouton"));
    }

    #[test]
    fn r2_does_not_match_role_inside_a_word() {
        assert_eq!(contains_role_word("Imagerie médicale"), None);
        assert_eq!(contains_role_word("Linkedin"), None);
        assert_eq!(contains_role_word("Icône de profil"), Some("icône"));
    }

    #[test]
    fn r2_passes_distinct_labels() {
        let s = screen(root(vec![
            clickable("android.widget.Button", [0, 0, 400, 200], Some("Valider")),
            clickable("android.widget.Button", [0, 300, 400, 500], Some("Annuler")),
        ]));
        let o = duplicate_or_redundant_label(&s, &android());
        assert!(o.applicable);
        assert!(o.findings.is_empty());
    }

    // ---- R3 ----

    #[test]
    fn r3_passes_switch_with_state() {
        let mut sw = clickable("android.widget.Switch", [0, 0, 200, 150], Some("Wi-Fi"));
        sw.a11y.checkable = Some(true);
        sw.a11y.checked = Some(false);
        let o = toggle_state_exposed(&screen(root(vec![sw])), &android());
        assert!(o.applicable);
        assert!(o.findings.is_empty());
    }

    #[test]
    fn r3_flags_switch_without_state() {
        let mut sw = clickable("android.widget.Switch", [0, 0, 200, 150], Some("Wi-Fi"));
        sw.a11y.checkable = Some(false);
        sw.a11y.checked = Some(false);
        let o = toggle_state_exposed(&screen(root(vec![sw])), &android());
        assert_eq!(o.findings.len(), 1);
    }

    #[test]
    fn r3_not_applicable_without_toggles() {
        let o = toggle_state_exposed(
            &screen(root(vec![clickable(
                "android.widget.Button",
                [0, 0, 400, 200],
                Some("OK"),
            )])),
            &android(),
        );
        assert!(!o.applicable);
    }

    // ---- iOS (classes from hierarchy::ios) ----

    #[test]
    fn ios_switch_with_value_exposes_state() {
        let json = r#"{"elementType":1,"frame":{"X":0,"Y":0,"Width":390,"Height":844},"children":[
            {"elementType":40,"label":"Wi-Fi","value":"1","frame":{"X":300,"Y":100,"Width":51,"Height":31}}]}"#;
        let root = crate::hierarchy::ios::parse_ios_axelement(json, Some((390, 844)))
            .unwrap()
            .root
            .unwrap();
        let o = toggle_state_exposed(&screen(root), &ios());
        assert!(o.applicable);
        assert!(o.findings.is_empty());
    }

    #[test]
    fn ios_unlabeled_image_button_fails_r1() {
        let json = r#"{"elementType":1,"frame":{"X":0,"Y":0,"Width":390,"Height":844},"children":[
            {"elementType":9,"frame":{"X":10,"Y":10,"Width":44,"Height":44}}]}"#;
        let root = crate::hierarchy::ios::parse_ios_axelement(json, Some((390, 844)))
            .unwrap()
            .root
            .unwrap();
        let o = missing_name(&screen(root), &ios());
        assert_eq!(o.findings.len(), 1);
    }

    #[test]
    fn ios_44pt_target_passes_b1() {
        let json = r#"{"elementType":1,"frame":{"X":0,"Y":0,"Width":390,"Height":844},"children":[
            {"elementType":9,"label":"Fermer","frame":{"X":10,"Y":10,"Width":44,"Height":44}}]}"#;
        let root = crate::hierarchy::ios::parse_ios_axelement(json, Some((390, 844)))
            .unwrap()
            .root
            .unwrap();
        let o = touch_target_size(&screen(root), &ios());
        assert!(o.applicable);
        assert!(o.findings.is_empty(), "{:?}", o.findings);
    }

    #[test]
    fn ios_search_field_with_placeholder_passes_r1() {
        let json = r#"{"elementType":1,"frame":{"X":0,"Y":0,"Width":390,"Height":844},"children":[
            {"elementType":45,"placeholderValue":"Rechercher","frame":{"X":10,"Y":10,"Width":300,"Height":36}}]}"#;
        let root = crate::hierarchy::ios::parse_ios_axelement(json, Some((390, 844)))
            .unwrap()
            .root
            .unwrap();
        let o = missing_name(&screen(root), &ios());
        assert!(o.applicable);
        assert!(o.findings.is_empty());
    }

    // ---- B1 ----

    #[test]
    fn b1_flags_small_target() {
        // 100 px at 2.625 px/dp ≈ 38 dp
        let o = touch_target_size(
            &screen(root(vec![clickable(
                "android.widget.Button",
                [0, 0, 100, 100],
                Some("x"),
            )])),
            &android(),
        );
        assert_eq!(o.findings.len(), 1);
        assert!(o.findings[0].message.contains("38×38 dp"));
    }

    #[test]
    fn b1_accepts_48dp_target() {
        let o = touch_target_size(
            &screen(root(vec![clickable(
                "android.widget.Button",
                [0, 0, 126, 126],
                Some("x"),
            )])),
            &android(),
        );
        assert!(o.findings.is_empty());
    }
}
