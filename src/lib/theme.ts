// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { ThemeMode } from "@/stores/settingsStore";

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light";
  }
  return mode;
}

export function applyTheme(mode: ThemeMode): void {
  const resolved = resolveTheme(mode);
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function watchSystemTheme(handler: (dark: boolean) => void): () => void {
  const mq = window.matchMedia(MEDIA_QUERY);
  const listener = (e: MediaQueryListEvent) => handler(e.matches);
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}
