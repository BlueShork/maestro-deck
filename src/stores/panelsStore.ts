// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Zustand persist migration — exported for unit-test coverage.
 *
 * v0 → v1: Force `visible.metrics` to `false`.
 * Old builds defaulted metrics to `true`; upgrade must honour the new
 * "closed-by-default / opening starts capture" design without clobbering
 * the user's other panel visibility preferences.
 */
export function migratePanelsStore(persisted: unknown, fromVersion: number): unknown {
  if (fromVersion < 1) {
    const state = persisted as Record<string, unknown> | null | undefined;
    const visible = (state?.visible ?? {}) as Record<string, unknown>;
    return {
      ...state,
      visible: { ...visible, metrics: false },
    };
  }
  return persisted;
}

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
        // Performance tab is closed by default — opening it is what starts
        // metric capture (see App.tsx). It does not auto-capture on launch.
        metrics: false,
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
            metrics: false,
          },
        })),
    }),
    {
      name: "maestro-deck.panels",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      migrate: migratePanelsStore,
    },
  ),
);
