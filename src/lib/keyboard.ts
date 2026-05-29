// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useEffect } from "react";

export type ShortcutHandler = (e: KeyboardEvent) => void;

export interface ShortcutBinding {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: ShortcutHandler;
  allowInInput?: boolean;
}

// When the full-screen settings page is open, the workspace (`MainView`) stays
// mounted but hidden so returning to it is instant. Its global shortcuts
// (⌘R run, ⌘S save, inspect-key, ⌘⇧S screenshot) must not fire while the user
// is in settings, so we gate every `useShortcuts` listener through this flag
// rather than prop-drilling "settings open" down to each consumer.
let suppressed = false;

export function setShortcutsSuppressed(value: boolean): void {
  suppressed = value;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  if (target.closest(".monaco-editor")) return true;
  return false;
}

export function useShortcuts(bindings: ShortcutBinding[]): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (suppressed) return;
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      for (const b of bindings) {
        if (b.key.toLowerCase() !== e.key.toLowerCase()) continue;
        if (!!b.mod !== mod) continue;
        if (!!b.shift !== e.shiftKey) continue;
        if (!!b.alt !== e.altKey) continue;
        if (!b.allowInInput && isEditable(e.target)) continue;
        e.preventDefault();
        b.handler(e);
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bindings]);
}
