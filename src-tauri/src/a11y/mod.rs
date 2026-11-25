// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Automated accessibility pre-audit (EFREI lot 1).
//!
//! Checks the screens seen during a run against a subset of the Luxembourg
//! mobile accessibility standard (RAAM 1.1). Each rule is a pure function
//! over one screen (UI hierarchy + optional screenshot), so rules can be
//! unit-tested on fixtures. `audit` aggregates the findings per criterion,
//! across every screen, into a score and a verdict.
//!
//! This is a *pre-audit*: it covers a handful of the 108 RAAM criteria and
//! never replaces a manual audit. The report says so explicitly.

pub mod contrast;
pub mod ipc;
pub mod rules;

use image::RgbaImage;
use serde::{Deserialize, Serialize};

use crate::hierarchy::{walk, Bounds, UINode};

/// Total number of criteria in RAAM 1.1.
pub const RAAM_TOTAL: usize = 108;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Android,
    Ios,
}

/// One screen captured during a run.
pub struct Screen {
    /// Human name (the `takeScreenshot` name, or "final").
    pub name: String,
    pub root: UINode,
    /// Screenshot of the same screen. Rules that need pixels (contrast) are
    /// skipped for this screen when it's missing.
    pub screenshot: Option<RgbaImage>,
}

#[derive(Debug, Clone)]
pub struct AuditConfig {
    pub platform: Platform,
    /// Physical pixels per dp (Android) or per pt (iOS). `None` = estimate
    /// from the screen width.
    pub px_per_unit: Option<f32>,
}

impl AuditConfig {
    pub fn new(platform: Platform) -> Self {
        Self {
            platform,
            px_per_unit: None,
        }
    }

    /// Pixel density used for size-based rules. Without a value from the
    /// device, assume a typical phone width (411 dp / 390 pt).
    pub fn density(&self, root: &UINode) -> f32 {
        if let Some(d) = self.px_per_unit.filter(|d| *d > 0.0) {
            return d;
        }
        let width = (root.bounds.right - root.bounds.left).max(1) as f32;
        let typical = match self.platform {
            Platform::Android => 411.0,
            Platform::Ios => 390.0,
        };
        (width / typical).max(1.0)
    }
}

/// A single problem found on one element.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub screen: String,
    /// Short description of the element (class + label or resource id).
    pub element: String,
    pub message: String,
    pub bounds: [i32; 4],
    /// `true` when the rule isn't sure (e.g. contrast on a busy background):
    /// shown as "à vérifier", never counted as a failure.
    pub needs_review: bool,
}

/// What a rule returns for one screen.
#[derive(Debug, Default)]
pub struct RuleOutcome {
    /// At least one element this rule is about was on screen.
    pub applicable: bool,
    pub findings: Vec<Finding>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CriterionStatus {
    Passed,
    Failed,
    NotApplicable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionResult {
    pub id: &'static str,
    pub title: &'static str,
    /// RAAM 1.1 criteria this check maps to. Empty for best practices.
    pub raam: Vec<&'static str>,
    pub status: CriterionStatus,
    pub failures: Vec<Finding>,
    pub to_review: Vec<Finding>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Compliant,
    NonCompliant,
    /// No automated criterion applied to the screens seen.
    NotEvaluated,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    /// Distinct RAAM criteria checked automatically by this run.
    pub automated: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessibilityReport {
    pub standard: &'static str,
    pub coverage: Coverage,
    pub screens: Vec<String>,
    /// Passed / applicable RAAM criteria, 0–100. `None` when nothing applied.
    pub score: Option<u8>,
    pub verdict: Verdict,
    pub criteria: Vec<CriterionResult>,
    /// Checks outside RAAM (e.g. touch target size): reported, not scored.
    pub best_practices: Vec<CriterionResult>,
    pub disclaimer: String,
}

/// Runs every rule on every screen and aggregates the result.
pub fn audit(screens: &[Screen], config: &AuditConfig) -> AccessibilityReport {
    let mut criteria = Vec::new();
    let mut best_practices = Vec::new();

    for rule in rules::all() {
        let mut applicable = false;
        let mut failures = Vec::new();
        let mut to_review = Vec::new();
        for screen in screens {
            let outcome = (rule.check)(screen, config);
            applicable |= outcome.applicable;
            for f in outcome.findings {
                if f.needs_review {
                    to_review.push(f);
                } else {
                    failures.push(f);
                }
            }
        }
        let status = if !applicable {
            CriterionStatus::NotApplicable
        } else if failures.is_empty() {
            CriterionStatus::Passed
        } else {
            CriterionStatus::Failed
        };
        let result = CriterionResult {
            id: rule.id,
            title: rule.title,
            raam: rule.raam.to_vec(),
            status,
            failures,
            to_review,
        };
        if rule.raam.is_empty() {
            best_practices.push(result);
        } else {
            criteria.push(result);
        }
    }

    let applicable = criteria
        .iter()
        .filter(|c| c.status != CriterionStatus::NotApplicable)
        .count();
    let passed = criteria
        .iter()
        .filter(|c| c.status == CriterionStatus::Passed)
        .count();
    let score = (applicable > 0).then(|| ((passed * 100) as f32 / applicable as f32).round() as u8);
    let verdict = match score {
        None => Verdict::NotEvaluated,
        Some(100) => Verdict::Compliant,
        Some(_) => Verdict::NonCompliant,
    };

    let mut raam_ids: Vec<&str> = criteria
        .iter()
        .flat_map(|c| c.raam.iter().copied())
        .collect();
    raam_ids.sort_unstable();
    raam_ids.dedup();
    let automated = raam_ids.len();

    AccessibilityReport {
        standard: "RAAM 1.1",
        coverage: Coverage {
            automated,
            total: RAAM_TOTAL,
        },
        screens: screens.iter().map(|s| s.name.clone()).collect(),
        score,
        verdict,
        criteria,
        best_practices,
        disclaimer: format!(
            "Pré-audit automatique couvrant {automated} critères sur {RAAM_TOTAL} du RAAM 1.1. Ne remplace pas un audit RAAM."
        ),
    }
}

// ---------- helpers shared by rules ----------

/// Nodes worth auditing: visible, on screen, not the system UI.
pub(crate) fn app_nodes(root: &UINode) -> Vec<&UINode> {
    let mut out = Vec::new();
    walk(root, &mut |n| {
        if is_visible(&n.bounds) && !is_system_ui(n) && n.class_name != "hierarchy" {
            out.push(n);
        }
    });
    out
}

pub(crate) fn is_visible(b: &Bounds) -> bool {
    b.right > b.left && b.bottom > b.top
}

pub(crate) fn is_system_ui(n: &UINode) -> bool {
    n.package == "com.android.systemui" || n.package == "com.sec.android.app.launcher"
}

/// What a screen reader would announce for this node alone.
pub(crate) fn own_label(n: &UINode) -> Option<&str> {
    n.content_desc
        .as_deref()
        .or(n.text.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Label of the node, or of its descendants (Android merges child text into
/// a clickable container's announcement).
pub(crate) fn merged_label(n: &UINode) -> Option<String> {
    if let Some(l) = own_label(n) {
        return Some(l.to_string());
    }
    let mut parts = Vec::new();
    for c in &n.children {
        walk(c, &mut |d| {
            if let Some(l) = own_label(d) {
                parts.push(l.to_string());
            }
        });
    }
    (!parts.is_empty()).then(|| parts.join(" "))
}

pub(crate) fn short_class(n: &UINode) -> &str {
    n.class_name.rsplit('.').next().unwrap_or(&n.class_name)
}

pub(crate) fn describe(n: &UINode) -> String {
    let class = short_class(n);
    match (own_label(n), n.resource_id.as_deref()) {
        (Some(l), _) => format!("{class} « {l} »"),
        (None, Some(id)) => format!("{class} #{}", id.rsplit('/').next().unwrap_or(id)),
        (None, None) => format!("{class} (sans libellé)"),
    }
}

pub(crate) fn finding(screen: &Screen, n: &UINode, message: impl Into<String>) -> Finding {
    Finding {
        screen: screen.name.clone(),
        element: describe(n),
        message: message.into(),
        bounds: [n.bounds.left, n.bounds.top, n.bounds.right, n.bounds.bottom],
        needs_review: false,
    }
}

#[cfg(test)]
pub(crate) mod testutil {
    use super::*;
    use crate::hierarchy::A11yAttrs;

    pub fn node(class: &str, bounds: [i32; 4]) -> UINode {
        UINode {
            id: "0".into(),
            resource_id: None,
            text: None,
            content_desc: None,
            class_name: class.into(),
            package: "com.example.app".into(),
            bounds: Bounds {
                left: bounds[0],
                top: bounds[1],
                right: bounds[2],
                bottom: bounds[3],
            },
            clickable: false,
            enabled: true,
            focused: false,
            a11y: A11yAttrs::default(),
            children: vec![],
        }
    }

    pub fn root(children: Vec<UINode>) -> UINode {
        let mut r = node("android.widget.FrameLayout", [0, 0, 1080, 2400]);
        r.children = children;
        r
    }

    pub fn screen(root: UINode) -> Screen {
        Screen {
            name: "home".into(),
            root,
            screenshot: None,
        }
    }

    pub fn ios() -> AuditConfig {
        AuditConfig {
            platform: Platform::Ios,
            px_per_unit: None,
        }
    }

    pub fn android() -> AuditConfig {
        AuditConfig {
            platform: Platform::Android,
            px_per_unit: Some(2.625),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testutil::*;
    use super::*;

    #[test]
    fn accessible_screen_is_compliant() {
        let mut btn = node("android.widget.Button", [0, 0, 400, 200]);
        btn.clickable = true;
        btn.text = Some("Valider".into());
        let report = audit(&[screen(root(vec![btn]))], &android());
        assert_eq!(report.verdict, Verdict::Compliant);
        assert_eq!(report.score, Some(100));
    }

    #[test]
    fn unlabeled_icon_button_fails_and_lowers_score() {
        let mut ok = node("android.widget.Button", [0, 0, 400, 200]);
        ok.clickable = true;
        ok.text = Some("Valider".into());
        let mut icon = node("android.widget.ImageButton", [0, 300, 200, 500]);
        icon.clickable = true;
        let report = audit(&[screen(root(vec![ok, icon]))], &android());
        assert_eq!(report.verdict, Verdict::NonCompliant);
        let r1 = report.criteria.iter().find(|c| c.id == "R1").unwrap();
        assert_eq!(r1.status, CriterionStatus::Failed);
        assert_eq!(r1.failures.len(), 1);
        assert!(report.score.unwrap() < 100);
    }

    #[test]
    fn empty_screen_is_not_evaluated() {
        let report = audit(&[screen(root(vec![]))], &android());
        assert_eq!(report.verdict, Verdict::NotEvaluated);
        assert_eq!(report.score, None);
    }

    #[test]
    fn best_practices_do_not_affect_score() {
        let mut tiny = node("android.widget.Button", [0, 0, 60, 60]);
        tiny.clickable = true;
        tiny.text = Some("OK".into());
        let report = audit(&[screen(root(vec![tiny]))], &android());
        assert_eq!(report.score, Some(100));
        let b1 = report.best_practices.iter().find(|c| c.id == "B1").unwrap();
        assert_eq!(b1.status, CriterionStatus::Failed);
    }

    #[test]
    fn coverage_counts_distinct_raam_criteria() {
        let report = audit(&[], &android());
        assert!(report.coverage.automated >= 5);
        assert_eq!(report.coverage.total, 108);
        assert!(report.disclaimer.contains("Ne remplace pas"));
    }

    #[test]
    fn density_is_estimated_from_width() {
        let cfg = AuditConfig::new(Platform::Android);
        let d = cfg.density(&root(vec![]));
        assert!((d - 1080.0 / 411.0).abs() < 0.01);
    }
}
