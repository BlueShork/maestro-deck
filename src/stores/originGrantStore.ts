// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";

/**
 * The one open "may plugin X reach host Y?" question. A plugin must not be
 * able to trap the user in it or change it under their click, so: a request
 * while a question is open is refused (the open one stays as shown), and once
 * the user refuses a plugin, its requests are refused without asking until
 * its panel is reopened (`forgetRefusal`).
 */
interface Pending {
  pluginId: string;
  pluginName: string;
  origin: string;
  resolve: (ok: boolean) => void;
}

interface OriginGrantState {
  pending: Pending | null;
  /** Plugin ids the user refused since their panel was opened. */
  refused: Record<string, true>;
  ask: (pluginId: string, pluginName: string, origin: string) => Promise<boolean>;
  answer: (ok: boolean) => void;
  forgetRefusal: (pluginId: string) => void;
}

export const useOriginGrantStore = create<OriginGrantState>()((set, get) => ({
  pending: null,
  refused: {},
  ask: (pluginId, pluginName, origin) => {
    const { pending, refused } = get();
    if (pending || refused[pluginId]) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      set({ pending: { pluginId, pluginName, origin, resolve } });
    });
  },
  answer: (ok) => {
    const p = get().pending;
    if (!p) return;
    set((s) => ({
      pending: null,
      refused: ok ? s.refused : { ...s.refused, [p.pluginId]: true },
    }));
    p.resolve(ok);
  },
  forgetRefusal: (pluginId) =>
    set((s) => {
      const { [pluginId]: _, ...rest } = s.refused;
      return { refused: rest };
    }),
}));

export const askOriginGrant = (pluginId: string, pluginName: string, origin: string) =>
  useOriginGrantStore.getState().ask(pluginId, pluginName, origin);
