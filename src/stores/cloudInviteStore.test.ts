// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  const storage = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: (k: string) => {
      storage.delete(k);
    },
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

import { useCloudInviteStore } from "./cloudInviteStore";

beforeEach(() => {
  useCloudInviteStore.setState({ asked: false, open: false });
});

describe("cloudInviteStore", () => {
  it("opens the invite the first time it is offered", () => {
    useCloudInviteStore.getState().offer();
    expect(useCloudInviteStore.getState().open).toBe(true);
    expect(useCloudInviteStore.getState().asked).toBe(true);
  });

  // The whole point of the design: one ask, ever. A user who declined must
  // never see it again, however many successful runs follow.
  it("never offers again after being declined", () => {
    useCloudInviteStore.getState().offer();
    useCloudInviteStore.getState().close();

    useCloudInviteStore.getState().offer();

    expect(useCloudInviteStore.getState().open).toBe(false);
  });

  // Escape-ing the dialog answers it just as much as clicking "Not now".
  it("counts a dialog shown but never answered as asked", () => {
    useCloudInviteStore.getState().offer();
    expect(useCloudInviteStore.getState().asked).toBe(true);

    // Simulates a restart: the ephemeral `open` resets, `asked` persists.
    useCloudInviteStore.setState({ open: false });
    useCloudInviteStore.getState().offer();

    expect(useCloudInviteStore.getState().open).toBe(false);
  });

  it("persists only the asked flag, not visibility", () => {
    useCloudInviteStore.getState().offer();
    const persisted = JSON.parse(localStorage.getItem("maestro-deck.cloud-invite") ?? "{}") as {
      state?: Record<string, unknown>;
    };
    expect(persisted.state).toEqual({ asked: true });
  });
});
