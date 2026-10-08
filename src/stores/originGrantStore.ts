// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";

/**
 * The one pending "may plugin X reach host Y?" question. A plugin asking
 * again while a question is open refuses the older one, so no caller hangs.
 */
interface Pending {
  pluginName: string;
  origin: string;
  resolve: (ok: boolean) => void;
}

interface OriginGrantState {
  pending: Pending | null;
  ask: (pluginName: string, origin: string) => Promise<boolean>;
  answer: (ok: boolean) => void;
}

export const useOriginGrantStore = create<OriginGrantState>()((set, get) => ({
  pending: null,
  ask: (pluginName, origin) =>
    new Promise<boolean>((resolve) => {
      get().pending?.resolve(false);
      set({ pending: { pluginName, origin, resolve } });
    }),
  answer: (ok) => {
    const p = get().pending;
    set({ pending: null });
    p?.resolve(ok);
  },
}));

export const askOriginGrant = (pluginName: string, origin: string) =>
  useOriginGrantStore.getState().ask(pluginName, origin);
