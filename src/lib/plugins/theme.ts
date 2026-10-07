// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/** Design tokens sent to plugins, as the raw HSL triplets from globals.css
 *  (e.g. "240 9% 7%"), so a plugin styles with `hsl(var(--background))`. */
const TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "muted",
  "muted-foreground",
  "border",
  "input",
  "primary",
  "primary-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "ring",
  "brand",
  "brand-foreground",
  "radius",
];

export function readThemeVars(): { mode: "light" | "dark"; vars: Record<string, string> } {
  const style = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const t of TOKENS) vars[t] = style.getPropertyValue(`--${t}`).trim();
  return { mode: document.documentElement.classList.contains("dark") ? "dark" : "light", vars };
}
