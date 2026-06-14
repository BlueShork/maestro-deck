// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, beforeEach, vi } from "vitest";

import { check } from "@tauri-apps/plugin-updater";
import { useToastStore } from "./toastStore";
import { useUpdateStore } from "./updateStore";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

const mockCheck = vi.mocked(check);

beforeEach(() => {
  mockCheck.mockReset();
  useUpdateStore.getState().reset();
  useToastStore.setState({ toasts: [] });
});

describe("updateStore.check — silent failures", () => {
  it("does NOT surface an error UI when a silent check fails", async () => {
    mockCheck.mockRejectedValue(
      new Error("update endpoint did not respond with a successful status code"),
    );

    await useUpdateStore.getState().check({ silent: true });

    // A background startup check must stay invisible: no error phase (which
    // would pop the UpdateDialog) and no toast.
    expect(useUpdateStore.getState().phase).not.toBe("error");
    expect(useUpdateStore.getState().error).toBeNull();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("still surfaces an error UI when a user-initiated check fails", async () => {
    mockCheck.mockRejectedValue(new Error("boom"));

    await useUpdateStore.getState().check({ silent: false });

    expect(useUpdateStore.getState().phase).toBe("error");
    expect(useUpdateStore.getState().error).toBe("boom");
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("reports not-available for a silent check with no update", async () => {
    mockCheck.mockResolvedValue(null);

    await useUpdateStore.getState().check({ silent: true });

    expect(useUpdateStore.getState().phase).toBe("not-available");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
