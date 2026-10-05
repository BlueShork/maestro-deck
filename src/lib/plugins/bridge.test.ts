// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it, vi } from "vitest";

import {
  clearPluginStorage,
  errorCode,
  handleRpc,
  isRpcRequest,
  storageKey,
  type BridgeDeps,
} from "./bridge";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function deps(over: Partial<BridgeDeps> = {}): BridgeDeps {
  return {
    manifest: {
      id: "jira",
      name: "Jira",
      version: "1.0.0",
      minAppVersion: "1.1.0",
      entry: "index.html",
      permissions: { http: ["https://*.atlassian.net"], open: [], secrets: true },
    },
    secretGet: vi.fn(async () => "s"),
    secretSet: vi.fn(async () => {}),
    secretDelete: vi.fn(async () => {}),
    httpFetch: vi.fn(async () => ({ status: 200, headers: {}, body: "{}" })),
    openExternal: vi.fn(async () => {}),
    toast: vi.fn(),
    appInfo: () => ({ appVersion: "1.1.0", platform: "macos" }),
    storage: memoryStorage(),
    ...over,
  };
}

const rpc = (method: string, params?: unknown) => ({
  type: "md-rpc" as const,
  id: "1",
  method,
  params,
});

describe("isRpcRequest", () => {
  it("accepts well-formed requests only", () => {
    expect(isRpcRequest(rpc("app.info"))).toBe(true);
    expect(isRpcRequest("hi")).toBe(false);
    expect(isRpcRequest(null)).toBe(false);
    expect(isRpcRequest({ type: "md-rpc", method: "x" })).toBe(false);
    expect(isRpcRequest({ type: "other", id: "1", method: "x" })).toBe(false);
    expect(isRpcRequest({ type: "md-rpc", id: "x".repeat(200), method: "x" })).toBe(false);
  });
});

describe("handleRpc", () => {
  it("answers app.info", async () => {
    const res = await handleRpc(rpc("app.info"), deps());
    expect(res).toEqual({
      type: "md-rpc-result",
      id: "1",
      ok: true,
      result: { appVersion: "1.1.0", platform: "macos" },
    });
  });

  it("rejects unknown methods", async () => {
    const res = await handleRpc(rpc("fs.read"), deps());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("unknown_method");
  });

  it("forbids secrets without the permission", async () => {
    const d = deps();
    d.manifest = { ...d.manifest, permissions: { ...d.manifest.permissions, secrets: false } };
    const res = await handleRpc(rpc("secrets.get", { key: "credentials" }), d);
    expect(!res.ok && res.error.code).toBe("forbidden");
    expect(d.secretGet).not.toHaveBeenCalled();
  });

  it("validates secret keys", async () => {
    const res = await handleRpc(rpc("secrets.set", { key: "Bad Key", value: "x" }), deps());
    expect(!res.ok && res.error.code).toBe("bad_request");
  });

  it("round-trips storage under the plugin namespace", async () => {
    const d = deps();
    await handleRpc(rpc("storage.set", { key: "last", value: { project: "ACME" } }), d);
    expect(d.storage.getItem(storageKey("jira", "last"))).toBe('{"project":"ACME"}');
    const res = await handleRpc(rpc("storage.get", { key: "last" }), d);
    expect(res.ok && res.result).toEqual({ project: "ACME" });
    const missing = await handleRpc(rpc("storage.get", { key: "nope" }), d);
    expect(missing.ok && missing.result).toBeNull();
  });

  it("refuses storage values over 64 KB", async () => {
    const res = await handleRpc(
      rpc("storage.set", { key: "big", value: "x".repeat(70_000) }),
      deps(),
    );
    expect(!res.ok && res.error.code).toBe("bad_request");
  });

  it("maps host errors to codes", async () => {
    const d = deps({
      httpFetch: vi.fn(async () => {
        throw new Error("IPC plugin_http_fetch failed: forbidden: https://x is not allowed");
      }),
    });
    const res = await handleRpc(rpc("http.fetch", { url: "https://x", method: "GET" }), d);
    expect(!res.ok && res.error.code).toBe("forbidden");
  });

  it("passes toasts with an https action through and rejects others", async () => {
    const d = deps();
    await handleRpc(
      rpc("ui.toast", {
        kind: "success",
        message: "ACME-1 created",
        action: { label: "Open", url: "https://acme.atlassian.net/browse/ACME-1" },
      }),
      d,
    );
    expect(d.toast).toHaveBeenCalledWith({
      kind: "success",
      message: "ACME-1 created",
      action: { label: "Open", url: "https://acme.atlassian.net/browse/ACME-1" },
    });
    const bad = await handleRpc(
      rpc("ui.toast", {
        kind: "success",
        message: "x",
        action: { label: "Open", url: "javascript:alert(1)" },
      }),
      d,
    );
    expect(!bad.ok && bad.error.code).toBe("bad_request");
  });
});

describe("errorCode", () => {
  it("extracts known prefixes anywhere in the message", () => {
    expect(errorCode(new Error("IPC x failed: timeout: slow"))).toBe("timeout");
    expect(errorCode(new Error("network: dns"))).toBe("network");
    expect(errorCode("boom")).toBe("internal");
  });
});

describe("clearPluginStorage", () => {
  it("removes only that plugin's keys", () => {
    const s = memoryStorage();
    s.setItem(storageKey("jira", "a"), "1");
    s.setItem(storageKey("jira-x", "a"), "1");
    s.setItem("maestro-deck.panels", "1");
    clearPluginStorage("jira", s);
    expect(s.getItem(storageKey("jira", "a"))).toBeNull();
    expect(s.getItem(storageKey("jira-x", "a"))).toBe("1");
    expect(s.getItem("maestro-deck.panels")).toBe("1");
  });
});
