// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/** Accessibility pre-audit (RAAM 1.1), as returned by `a11y_audit_screen`.
 *  Mirrors `src-tauri/src/a11y/mod.rs`. */

export interface A11yFinding {
  screen: string;
  /** Short description of the element (class + label or resource id). */
  element: string;
  message: string;
  /** [left, top, right, bottom] in device pixels. */
  bounds: [number, number, number, number];
  /** Unsure result: shown as "à vérifier", never counted as a failure. */
  needsReview: boolean;
}

export type A11yCriterionStatus = "passed" | "failed" | "not_applicable";

export interface A11yCriterion {
  id: string;
  title: string;
  /** RAAM 1.1 criteria this check maps to (empty for best practices). */
  raam: string[];
  status: A11yCriterionStatus;
  failures: A11yFinding[];
  toReview: A11yFinding[];
}

export type A11yVerdict = "compliant" | "non_compliant" | "not_evaluated";

export interface AccessibilityReport {
  standard: "RAAM 1.1";
  coverage: { automated: number; total: number };
  screens: string[];
  /** Passed / applicable criteria, 0–100. Null when nothing applied. */
  score: number | null;
  verdict: A11yVerdict;
  criteria: A11yCriterion[];
  /** Checks outside RAAM (touch target size): reported, not scored. */
  bestPractices: A11yCriterion[];
  disclaimer: string;
}

export type A11yPlatform = "android" | "ios";
