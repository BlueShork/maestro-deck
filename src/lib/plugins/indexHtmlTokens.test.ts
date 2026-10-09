// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

// Vite's ?raw reads the file from the repo root (no node typings in this project).
import html from "../../../index.html?raw";
import { THEME_TOKENS } from "./types";

describe("index.html early theme script", () => {
  it("lists exactly the host THEME_TOKENS", () => {
    const m = /var tokens = (\[[^\]]*\])/.exec(html);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1].replace(/,\s*\]$/, "]"))).toEqual([...THEME_TOKENS]);
  });
});
