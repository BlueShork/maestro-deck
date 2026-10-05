// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

import { pluginUrl } from "./url";

describe("pluginUrl", () => {
  it("uses the custom scheme on macOS/Linux", () => {
    expect(pluginUrl("jira", "index.html", "Mozilla/5.0 (Macintosh)")).toBe(
      "mdplugin://localhost/jira/index.html",
    );
  });
  it("uses the localhost form on Windows", () => {
    expect(pluginUrl("jira", "index.html", "Mozilla/5.0 (Windows NT 10.0)")).toBe(
      "http://mdplugin.localhost/jira/index.html",
    );
  });
  it("encodes each segment but keeps the slashes", () => {
    expect(pluginUrl("jira", "assets/a b.js", "Macintosh")).toBe(
      "mdplugin://localhost/jira/assets/a%20b.js",
    );
  });
});
