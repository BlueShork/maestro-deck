// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * `null` means the user hasn't answered yet — nothing is ever sent in that
 * state. Only an explicit "granted" turns telemetry on.
 */
export type TelemetryConsent = "granted" | "denied" | null;

interface TelemetryState {
  consent: TelemetryConsent;
  /** When the answer was given (ISO string), kept as a record of consent. */
  decidedAt: string | null;
  /**
   * Random per-install identifier, created only once the user opts in. Not
   * derived from the machine, the user, or their Maestro Deck Cloud account —
   * it only lets us count installs instead of app launches.
   */
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
          // Opting out drops the identifier: opting back in later starts over
          // as a new, unlinked install.
          installId: granted ? (get().installId ?? crypto.randomUUID()) : null,
        }),
    }),
    {
      name: "maestro-deck.telemetry",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
