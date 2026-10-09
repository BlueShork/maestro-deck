// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { usePluginsStore } from "@/stores/pluginsStore";
import { useSettingsStore } from "@/stores/settingsStore";

import { syncColorTheme } from "./colorThemeSync";

/** Loads the installed plugins and keeps the chosen theme's cached tokens
 *  current (or falls back to the default if it disappeared). Returns the
 *  unsubscribe. */
export function startColorThemeSync(): () => void {
  const sync = () => {
    const p = usePluginsStore.getState();
    if (!p.installedLoaded) return;
    const s = useSettingsStore.getState();
    const next = syncColorTheme(s.colorTheme, s.colorThemeCache, p.installed);
    if (next) s.setColorTheme(next.id, next.theme);
  };
  void usePluginsStore.getState().refreshInstalled();
  const unsubscribe = usePluginsStore.subscribe(sync);
  // The list may already be loaded; subscribe alone would never fire.
  sync();
  return unsubscribe;
}
