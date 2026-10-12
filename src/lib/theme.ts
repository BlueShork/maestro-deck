// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { applyColorTheme, effectiveMode } from "@/lib/colorTheme";
import type { PluginTheme } from "@/lib/plugins/types";
import type { ThemeMode } from "@/stores/settingsStore";

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light";
  }
  return mode;
}

export function applyTheme(mode: ThemeMode, colorTheme: PluginTheme | null = null): void {
  const resolved = effectiveMode(colorTheme, resolveTheme(mode));
  document.documentElement.classList.toggle("dark", resolved === "dark");
  applyColorTheme(colorTheme, resolved);
}

export function watchSystemTheme(handler: (dark: boolean) => void): () => void {
  const mq = window.matchMedia(MEDIA_QUERY);
  const listener = (e: MediaQueryListEvent) => handler(e.matches);
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}
