// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { THEME_TOKENS, type PluginTheme } from "@/lib/plugins/types";

/** Same grammar Rust enforces; re-checked here because the cache lives in
 *  localStorage. */
const NUM = "(?:\\d+(?:\\.\\d+)?)";
const HSL_RE = new RegExp(`^${NUM} ${NUM}% ${NUM}%$`);
const RADIUS_RE = new RegExp(`^${NUM}rem$`);
const TOKENS = new Set<string>(THEME_TOKENS);

/** Custom properties currently set on <html>. Seeded from the DOM because the
 *  inline script in index.html writes the cached theme before this module runs. */
let applied: string[] = [...THEME_TOKENS.map((t) => `--${t}`), "--radius"].filter(
  (n) =>
    typeof document !== "undefined" && document.documentElement.style.getPropertyValue(n) !== "",
);

/** The mode a single-variant theme imposes, or null when the user chooses. */
export function forcedMode(t: PluginTheme | null): "light" | "dark" | null {
  if (!t) return null;
  if (t.light && !t.dark) return "light";
  if (t.dark && !t.light) return "dark";
  return null;
}

export function effectiveMode(t: PluginTheme | null, resolved: "light" | "dark") {
  return forcedMode(t) ?? resolved;
}

function validHsl(v: string): boolean {
  if (!HSL_RE.test(v)) return false;
  const [h, s, l] = v.split(" ").map((p) => parseFloat(p));
  return h <= 360 && s <= 100 && l <= 100;
}

/** Writes `t`'s variant for `mode` as inline custom properties, clearing the
 *  previous theme's first. `null` restores the stylesheet defaults. */
export function applyColorTheme(t: PluginTheme | null, mode: "light" | "dark"): void {
  const style = document.documentElement.style;
  for (const name of applied) style.removeProperty(name);
  applied = [];
  if (!t) return;
  const variant = (mode === "dark" ? t.dark : t.light) ?? {};
  for (const [token, value] of Object.entries(variant)) {
    if (!TOKENS.has(token) || typeof value !== "string" || !validHsl(value)) continue;
    style.setProperty(`--${token}`, value);
    applied.push(`--${token}`);
  }
  if (t.radius && RADIUS_RE.test(t.radius) && parseFloat(t.radius) <= 1) {
    style.setProperty("--radius", t.radius);
    applied.push("--radius");
  }
}
