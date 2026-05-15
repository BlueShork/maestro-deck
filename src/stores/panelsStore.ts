// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Which panels are visible in the main layout. Hidden panels collapse
 * to zero size in the `PanelGroup` — their sibling(s) absorb the space.
 * Users re-open them from the View menu in the Toolbar.
 *
 * Defaults match what the app looked like before resizable panels
 * landed, so a fresh install keeps its familiar layout.
 */
export type PanelId = "workspace" | "inspector" | "device" | "editor" | "console" | "metrics";

interface PanelsState {
  visible: Record<PanelId, boolean>;
  toggle: (id: PanelId) => void;
  show: (id: PanelId) => void;
  hide: (id: PanelId) => void;
  /** Restore every panel — safety hatch when the user has closed so many
   *  they can't find the View menu, or after clearing localStorage. */
  showAll: () => void;
}

export const usePanelsStore = create<PanelsState>()(
  persist(
    (set) => ({
      visible: {
        workspace: true,
        inspector: true,
        device: true,
        editor: true,
        console: true,
        // Metrics is still gated by the global perfMonitoringEnabled
        // setting; this flag just decides whether the pane is shown
        // when perf monitoring *is* enabled.
        metrics: true,
      },
      toggle: (id) =>
        set((s) => ({
          visible: { ...s.visible, [id]: !s.visible[id] },
        })),
      show: (id) =>
        set((s) => ({
          visible: { ...s.visible, [id]: true },
        })),
      hide: (id) =>
        set((s) => ({
          visible: { ...s.visible, [id]: false },
        })),
      showAll: () =>
        set(() => ({
          visible: {
            workspace: true,
            inspector: true,
            device: true,
            editor: true,
            console: true,
            metrics: true,
          },
        })),
    }),
    {
      name: "maestro-deck.panels",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
