// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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

vi.mock("@/lib/ipc", () => ({
  ipc: {
    environmentStatus: vi.fn().mockResolvedValue({ checks: [], minimalOk: null }),
    installTool: vi.fn(),
  },
  events: {
    onEnvInstallOutput: vi.fn().mockResolvedValue(() => {}),
    onEnvInstallDone: vi.fn().mockResolvedValue(() => {}),
  },
}));

import { SetupPopup } from "./SetupPopup";
import { useEnvStore } from "@/stores/envStore";
import type { EnvCheckId, EnvCheckStatus } from "@/lib/ipc";

const check = (id: EnvCheckId, status: EnvCheckStatus, version: string | null = null) => ({
  id,
  status,
  version,
  detail: null,
});

beforeEach(() => {
  useEnvStore.setState({
    checks: [],
    minimalOk: null,
    checking: false,
    installingId: null,
    lastInstallLine: null,
    installError: null,
    collapsed: false,
    dismissedForever: false,
  });
});

const render = () => renderToStaticMarkup(<SetupPopup />);

describe("SetupPopup", () => {
  it("renders nothing before the first check resolves", () => {
    // minimalOk is null → popup is not yet visible
    const markup = render();
    expect(markup).toBe("");
  });

  it("shows blocking rows with install button when minimum not met", () => {
    useEnvStore.setState({
      minimalOk: false,
      checks: [
        check("maestro", "wrong-version", "2.4.0"),
        check("java", "ok", "21"),
        check("adb", "missing"),
        check("xcode", "ok"),
      ],
    });
    const markup = render();
    expect(markup).toContain("Setup required");
    expect(markup).toContain("2.4.0");
    expect(markup).toContain("Install");
    // Not dismissible: no close button label while minimum unmet
    expect(markup).not.toMatch(/close/i);
  });

  it("collapses to a badge", () => {
    useEnvStore.setState({
      minimalOk: false,
      checks: [check("maestro", "missing")],
      collapsed: true,
    });
    const markup = render();
    expect(markup).toContain("Setup incomplete");
    expect(markup).not.toContain("Setup required");
  });
});
