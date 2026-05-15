// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useEffect } from "react";
import { writeTextFile } from "@tauri-apps/plugin-fs";

import { createAutosaveEngine } from "@/lib/autosaveEngine";
import { useFlowStore } from "@/stores/flowStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { toast } from "@/stores/toastStore";

const AUTOSAVE_DELAY_MS = 1000;

export function useAutosave(): void {
  useEffect(() => {
    const engine = createAutosaveEngine({
      write: async (path, content) => {
        await writeTextFile(path, content);
        // Only flip dirty if the buffer is still on this path — a Save-As
        // racing with an in-flight autosave would otherwise revert filePath.
        if (useFlowStore.getState().filePath === path) {
          useFlowStore.getState().saved(path);
        }
      },
      onError: (message) => toast.error("Auto-save failed", message),
      getFlow: () => {
        const s = useFlowStore.getState();
        return { content: s.content, filePath: s.filePath, dirty: s.dirty };
      },
      getEnabled: () => useSettingsStore.getState().autoSaveEnabled,
      delayMs: AUTOSAVE_DELAY_MS,
    });

    let lastContent = useFlowStore.getState().content;
    let lastFilePath = useFlowStore.getState().filePath;
    let lastDirty = useFlowStore.getState().dirty;

    const unsubscribeFlow = useFlowStore.subscribe((s) => {
      if (s.filePath !== lastFilePath) {
        lastFilePath = s.filePath;
        engine.notifyPathChanged(s.filePath);
      }
      if (lastDirty && !s.dirty) {
        engine.notifyDirtyCleared(s.filePath);
      }
      lastDirty = s.dirty;
      if (s.content !== lastContent) {
        lastContent = s.content;
        if (s.dirty) engine.notifyChange();
      }
    });

    return () => {
      unsubscribeFlow();
      engine.dispose();
    };
  }, []);
}
