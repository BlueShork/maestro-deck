// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { beforeEach, describe, expect, it } from "vitest";

import { askOriginGrant, useOriginGrantStore } from "./originGrantStore";

describe("originGrantStore", () => {
  beforeEach(() => useOriginGrantStore.getState().answer(false));

  it("resolves with the user's answer and clears the prompt", async () => {
    const p = askOriginGrant("GitLab", "https://git.acme.fr");
    expect(useOriginGrantStore.getState().pending).toMatchObject({
      pluginName: "GitLab",
      origin: "https://git.acme.fr",
    });
    useOriginGrantStore.getState().answer(true);
    await expect(p).resolves.toBe(true);
    expect(useOriginGrantStore.getState().pending).toBeNull();
  });

  it("a new request refuses the pending one", async () => {
    const first = askOriginGrant("GitLab", "https://a.fr");
    const second = askOriginGrant("GitLab", "https://b.fr");
    await expect(first).resolves.toBe(false);
    expect(useOriginGrantStore.getState().pending?.origin).toBe("https://b.fr");
    useOriginGrantStore.getState().answer(true);
    await expect(second).resolves.toBe(true);
  });
});
