// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";
import { normalizeFolderName } from "./workspace-ops";

describe("normalizeFolderName", () => {
  it("accepts a plain name and trims it", () => {
    expect(normalizeFolderName("  flows  ")).toBe("flows");
  });
  it("does not append an extension", () => {
    expect(normalizeFolderName("flows.yaml")).toBe("flows.yaml");
  });
  it("rejects empty / whitespace-only names", () => {
    expect(normalizeFolderName("")).toBeNull();
    expect(normalizeFolderName("   ")).toBeNull();
  });
  it("rejects names with path separators or shell specials", () => {
    expect(normalizeFolderName("a/b")).toBeNull();
    expect(normalizeFolderName("a\\b")).toBeNull();
    expect(normalizeFolderName("a:b")).toBeNull();
    expect(normalizeFolderName("a*b")).toBeNull();
  });
});
