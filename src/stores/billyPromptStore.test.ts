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

import { useBillyPromptStore } from "./billyPromptStore";

beforeEach(() => {
  useBillyPromptStore.setState({ customPrompt: null });
});

describe("billyPromptStore", () => {
  it("defaults to no override", () => {
    expect(useBillyPromptStore.getState().customPrompt).toBeNull();
  });

  it("setCustomPrompt stores the override", () => {
    useBillyPromptStore.getState().setCustomPrompt("You are a pirate.");
    expect(useBillyPromptStore.getState().customPrompt).toBe("You are a pirate.");
  });

  it("setCustomPrompt with blank/whitespace input clears the override", () => {
    useBillyPromptStore.getState().setCustomPrompt("something");
    useBillyPromptStore.getState().setCustomPrompt("   \n  ");
    expect(useBillyPromptStore.getState().customPrompt).toBeNull();
  });

  it("reset drops the override", () => {
    useBillyPromptStore.getState().setCustomPrompt("custom");
    useBillyPromptStore.getState().reset();
    expect(useBillyPromptStore.getState().customPrompt).toBeNull();
  });
});
