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
