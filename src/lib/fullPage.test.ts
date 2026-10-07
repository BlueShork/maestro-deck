// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

import { isFullPage } from "./fullPage";

describe("isFullPage", () => {
  it("covers every page that replaces the workspace", () => {
    for (const path of ["/settings/general", "/image-bank", "/account", "/plugins"]) {
      expect(isFullPage(path)).toBe(true);
    }
  });
  it("leaves the workspace visible at the root", () => {
    expect(isFullPage("/")).toBe(false);
  });
});
