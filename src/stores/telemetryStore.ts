// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type TelemetryConsent = "granted" | "denied" | null;

interface TelemetryState {
  consent: TelemetryConsent;
  decidedAt: string | null;
  installId: string | null;
  setConsent: (granted: boolean) => void;
}

export const useTelemetryStore = create<TelemetryState>()(
  persist(
    (set, get) => ({
      consent: null,
      decidedAt: null,
      installId: null,
      setConsent: (granted) =>
        set({
          consent: granted ? "granted" : "denied",
          decidedAt: new Date().toISOString(),
          installId: granted ? (get().installId ?? crypto.randomUUID()) : null,
        }),
    }),
    {
      name: "maestro-deck.telemetry",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
