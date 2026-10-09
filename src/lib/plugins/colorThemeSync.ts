// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { InstalledPlugin, PluginTheme } from "./types";

/** What the settings should become once the installed list is known: a fresh
 *  cache when the theme plugin changed, the default when it is gone or
 *  broken, or null when nothing needs to change. */
export function syncColorTheme(
  colorTheme: string | null,
  cache: PluginTheme | null,
  installed: InstalledPlugin[],
): { id: string | null; theme: PluginTheme | null } | null {
  if (!colorTheme) return null;
  const theme = installed.find((p) => p.id === colorTheme)?.theme ?? null;
  if (!theme) return { id: null, theme: null };
  return JSON.stringify(theme) === JSON.stringify(cache) ? null : { id: colorTheme, theme };
}
