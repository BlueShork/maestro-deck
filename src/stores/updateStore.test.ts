// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, beforeEach, vi } from "vitest";

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
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

type Progress =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

function fakeUpdate(
  run: (emit: (p: Progress) => void) => Promise<void> = async (emit) => {
    emit({ event: "Started", data: { contentLength: 1000 } });
    for (let i = 0; i < 10; i++) emit({ event: "Progress", data: { chunkLength: 100 } });
    emit({ event: "Finished" });
  },
) {
  return {
    version: "1.3.0",
    body: "Notes",
    downloadAndInstall: vi.fn((cb: (p: Progress) => void) => run(cb)),
  };
}

describe("updateStore.check — results", () => {
  it("exposes an available update with its notes", async () => {
    mockCheck.mockResolvedValue(fakeUpdate() as never);
    await useUpdateStore.getState().check();
    expect(useUpdateStore.getState()).toMatchObject({
      phase: "available",
      available: { version: "1.3.0", notes: "Notes" },
    });
  });

  it("tells a user who asked that they're up to date", async () => {
    mockCheck.mockResolvedValue(null);
    await useUpdateStore.getState().check();
    expect(useToastStore.getState().toasts.at(-1)?.title).toBe("You're up to date");
  });

  it("does not start a second check while one is running", async () => {
    let release!: (v: null) => void;
    mockCheck.mockReturnValue(new Promise((r) => (release = r)) as never);
    const first = useUpdateStore.getState().check();
    await useUpdateStore.getState().check();
    release(null);
    await first;
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });
});

describe("updateStore.downloadAndInstall", () => {
  beforeEach(() => vi.mocked(relaunch).mockReset());

  it("downloads, installs and relaunches", async () => {
    const update = fakeUpdate();
    mockCheck.mockResolvedValue(update as never);
    await useUpdateStore.getState().check();
    await useUpdateStore.getState().downloadAndInstall();
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(useUpdateStore.getState()).toMatchObject({ phase: "ready", downloadPercent: 100 });
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("only publishes whole-percent progress steps", async () => {
    const seen: number[] = [];
    const unsub = useUpdateStore.subscribe((s, prev) => {
      if (s.downloadPercent !== prev.downloadPercent) seen.push(s.downloadPercent);
    });
    const update = fakeUpdate(async (emit) => {
      emit({ event: "Started", data: { contentLength: 100_000 } });
      for (let i = 0; i < 1000; i++) emit({ event: "Progress", data: { chunkLength: 100 } });
      emit({ event: "Finished" });
    });
    let updates = 0;
    const countAll = useUpdateStore.subscribe(() => updates++);
    mockCheck.mockResolvedValue(update as never);
    await useUpdateStore.getState().check();
    updates = 0;
    await useUpdateStore.getState().downloadAndInstall();
    unsub();
    countAll();
    expect(seen.at(-1)).toBe(100);
    expect(seen.every((p, i) => i === 0 || p > seen[i - 1])).toBe(true);
    expect(updates).toBeLessThan(110);
  });

  it("reports progress as 0 when the size is unknown", async () => {
    const update = fakeUpdate(async (emit) => {
      emit({ event: "Started", data: {} });
      emit({ event: "Progress", data: { chunkLength: 5000 } });
      expect(useUpdateStore.getState().downloadPercent).toBe(0);
      emit({ event: "Finished" });
    });
    mockCheck.mockResolvedValue(update as never);
    await useUpdateStore.getState().check();
    await useUpdateStore.getState().downloadAndInstall();
    expect(useUpdateStore.getState().phase).toBe("ready");
  });

  it("a second click while downloading does not download twice", async () => {
    let finish!: () => void;
    const update = fakeUpdate(() => new Promise<void>((r) => (finish = r)));
    mockCheck.mockResolvedValue(update as never);
    await useUpdateStore.getState().check();
    const first = useUpdateStore.getState().downloadAndInstall();
    await useUpdateStore.getState().downloadAndInstall();
    finish();
    await first;
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
  });

  it("a check while installing leaves the pending update alone", async () => {
    let finish!: () => void;
    const update = fakeUpdate(
      (emit) =>
        new Promise<void>((r) => {
          emit({ event: "Finished" });
          finish = r;
        }),
    );
    mockCheck.mockResolvedValue(update as never);
    await useUpdateStore.getState().check();
    const install = useUpdateStore.getState().downloadAndInstall();
    expect(useUpdateStore.getState().phase).toBe("installing");
    mockCheck.mockClear();
    await useUpdateStore.getState().check();
    expect(mockCheck).not.toHaveBeenCalled();
    finish();
    await install;
    expect(useUpdateStore.getState().phase).toBe("ready");
  });

  it("surfaces an install failure", async () => {
    const update = fakeUpdate(async () => {
      throw new Error("signature mismatch");
    });
    mockCheck.mockResolvedValue(update as never);
    await useUpdateStore.getState().check();
    await useUpdateStore.getState().downloadAndInstall();
    expect(useUpdateStore.getState()).toMatchObject({
      phase: "error",
      error: "signature mismatch",
    });
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("does nothing without a pending update", async () => {
    await useUpdateStore.getState().downloadAndInstall();
    expect(useUpdateStore.getState().phase).toBe("idle");
  });
});
