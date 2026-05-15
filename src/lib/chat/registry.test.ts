// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi, beforeEach } from "vitest";

const getAnthropic = vi.fn();
const getVertex = vi.fn();

vi.mock("./credentials", () => ({
  credentials: {
    getAnthropic: () => getAnthropic(),
    getVertex: () => getVertex(),
  },
}));

vi.mock("./AnthropicProvider", () => ({
  AnthropicProvider: class {
    constructor(public apiKey: string) {}
    kind = "anthropic";
  },
}));

vi.mock("./VertexProvider", () => ({
  VertexProvider: class {
    constructor(
      public projectId: string,
      public region: string,
      public sa: string,
    ) {}
    kind = "vertex";
  },
}));

async function freshRegistry() {
  vi.resetModules();
  return await import("./registry");
}

beforeEach(() => {
  getAnthropic.mockReset();
  getVertex.mockReset();
});

describe("getProvider — anthropic", () => {
  it("returns null when no api key is stored", async () => {
    getAnthropic.mockResolvedValue(null);
    const { getProvider } = await freshRegistry();
    expect(await getProvider("anthropic")).toBeNull();
  });

  it("returns null when stored creds have no apiKey", async () => {
    getAnthropic.mockResolvedValue({ apiKey: "" });
    const { getProvider } = await freshRegistry();
    expect(await getProvider("anthropic")).toBeNull();
  });

  it("constructs and caches an AnthropicProvider on first hit", async () => {
    getAnthropic.mockResolvedValue({ apiKey: "sk-test" });
    const { getProvider } = await freshRegistry();
    const a = await getProvider("anthropic");
    const b = await getProvider("anthropic");
    expect(a).toBe(b);
    expect((a as unknown as { apiKey: string }).apiKey).toBe("sk-test");
    expect(getAnthropic).toHaveBeenCalledTimes(1);
  });
});

describe("getProvider — vertex", () => {
  it("returns null when any required field is missing", async () => {
    getVertex.mockResolvedValue({ projectId: "p", region: "us", serviceAccountJson: "" });
    const { getProvider } = await freshRegistry();
    expect(await getProvider("vertex")).toBeNull();
  });

  it("constructs and caches a VertexProvider", async () => {
    getVertex.mockResolvedValue({ projectId: "p", region: "us", serviceAccountJson: "{}" });
    const { getProvider } = await freshRegistry();
    const a = await getProvider("vertex");
    expect(a).not.toBeNull();
    expect((a as unknown as { projectId: string }).projectId).toBe("p");
    const b = await getProvider("vertex");
    expect(a).toBe(b);
    expect(getVertex).toHaveBeenCalledTimes(1);
  });
});

describe("invalidateProvider", () => {
  it("forces re-construction on next getProvider call", async () => {
    getAnthropic.mockResolvedValue({ apiKey: "sk-1" });
    const { getProvider, invalidateProvider } = await freshRegistry();
    const a = await getProvider("anthropic");
    invalidateProvider("anthropic");
    getAnthropic.mockResolvedValue({ apiKey: "sk-2" });
    const b = await getProvider("anthropic");
    expect(a).not.toBe(b);
    expect((b as unknown as { apiKey: string }).apiKey).toBe("sk-2");
  });
});
