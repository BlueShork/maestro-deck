// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";
import { buildPartialFlow } from "./partialFlow";

const SOURCE = `appId: com.example
---
- launchApp
- tapOn: "Login"
- inputText: "user"
- tapOn: "Submit"
- assertVisible: "Welcome"
`;

describe("buildPartialFlow", () => {
  it("truncates from a step line, preserving preamble", () => {
    const r = buildPartialFlow(SOURCE, 5);
    expect(r).not.toBeNull();
    expect(r!.content).toBe(
      `appId: com.example
---
- inputText: "user"
- tapOn: "Submit"
- assertVisible: "Welcome"
`,
    );
    expect(r!.firstStepOriginalLine).toBe(5);
    expect(r!.lineMap.get(1)).toBe(1);
    expect(r!.lineMap.get(2)).toBe(2);
    expect(r!.lineMap.get(3)).toBe(5);
    expect(r!.lineMap.get(4)).toBe(6);
    expect(r!.lineMap.get(5)).toBe(7);
  });

  it("returns the full source when clicking the first step line", () => {
    const r = buildPartialFlow(SOURCE, 3);
    expect(r).not.toBeNull();
    expect(r!.content).toBe(SOURCE);
    expect(r!.firstStepOriginalLine).toBe(3);
  });

  it("returns null when clicking below the last step", () => {
    const r = buildPartialFlow(SOURCE, 99);
    expect(r).toBeNull();
  });

  it("snaps to the next step when clicking a non-step line", () => {
    const yaml = `appId: x
---
- launchApp
# a comment

- tapOn: "Submit"
`;
    const r = buildPartialFlow(yaml, 4);
    expect(r).not.toBeNull();
    expect(r!.firstStepOriginalLine).toBe(6);
  });

  it("works with no preamble (single-document flow)", () => {
    const yaml = `- launchApp\n- tapOn: "X"\n- assertVisible: "Y"\n`;
    const r = buildPartialFlow(yaml, 2);
    expect(r).not.toBeNull();
    expect(r!.content).toBe(`- tapOn: "X"\n- assertVisible: "Y"\n`);
    expect(r!.firstStepOriginalLine).toBe(2);
    expect(r!.lineMap.get(1)).toBe(2);
    expect(r!.lineMap.get(2)).toBe(3);
  });

  it("preserves all preamble docs in multi-document sources", () => {
    const yaml = `helper: stuff
---
appId: com.example
---
- launchApp
- tapOn: "X"
`;
    const r = buildPartialFlow(yaml, 6);
    expect(r).not.toBeNull();
    expect(r!.content).toBe(
      `helper: stuff
---
appId: com.example
---
- tapOn: "X"
`,
    );
    expect(r!.firstStepOriginalLine).toBe(6);
  });

  it("returns null on invalid YAML", () => {
    const r = buildPartialFlow(`appId: x\n---\n- tapOn: [unclosed`, 3);
    expect(r).toBeNull();
  });
});
