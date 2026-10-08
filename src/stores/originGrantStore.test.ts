// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { beforeEach, describe, expect, it } from "vitest";

import { askOriginGrant, useOriginGrantStore } from "./originGrantStore";

describe("originGrantStore", () => {
  beforeEach(() => useOriginGrantStore.setState({ pending: null, refused: {} }));

  it("resolves with the user's answer and clears the prompt", async () => {
    const p = askOriginGrant("gitlab", "GitLab", "https://git.acme.fr");
    expect(useOriginGrantStore.getState().pending).toMatchObject({
      pluginName: "GitLab",
      origin: "https://git.acme.fr",
    });
    useOriginGrantStore.getState().answer(true);
    await expect(p).resolves.toBe(true);
    expect(useOriginGrantStore.getState().pending).toBeNull();
  });

  it("refuses a new request while a prompt is open, without touching the open one", async () => {
    const first = askOriginGrant("gitlab", "GitLab", "https://a.fr");
    const second = askOriginGrant("gitlab", "GitLab", "https://evil.example");
    await expect(second).resolves.toBe(false);
    expect(useOriginGrantStore.getState().pending?.origin).toBe("https://a.fr");
    useOriginGrantStore.getState().answer(true);
    await expect(first).resolves.toBe(true);
  });

  it("after a refusal, refuses that plugin without asking until forgotten", async () => {
    const first = askOriginGrant("gitlab", "GitLab", "https://a.fr");
    useOriginGrantStore.getState().answer(false);
    await expect(first).resolves.toBe(false);
    await expect(askOriginGrant("gitlab", "GitLab", "https://a.fr")).resolves.toBe(false);
    expect(useOriginGrantStore.getState().pending).toBeNull();

    const other = askOriginGrant("jira", "Jira", "https://b.fr");
    expect(useOriginGrantStore.getState().pending?.origin).toBe("https://b.fr");
    useOriginGrantStore.getState().answer(true);
    await expect(other).resolves.toBe(true);

    useOriginGrantStore.getState().forgetRefusal("gitlab");
    void askOriginGrant("gitlab", "GitLab", "https://a.fr");
    expect(useOriginGrantStore.getState().pending?.origin).toBe("https://a.fr");
  });
});
