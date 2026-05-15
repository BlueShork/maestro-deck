// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";
import { parseFlow } from "./flowAst";

describe("parseFlow", () => {
  it("parses a simple flow with command + arg + line", () => {
    const yaml = `appId: com.example.app
---
- launchApp
- tapOn: "Login"
- assertVisible: "Welcome"
`;
    const ast = parseFlow(yaml);
    expect(ast.steps).toEqual([
      { index: 0, line: 3, endLine: 3, command: "launchApp", arg: null },
      { index: 1, line: 4, endLine: 4, command: "tapOn", arg: "Login" },
      { index: 2, line: 5, endLine: 5, command: "assertVisible", arg: "Welcome" },
    ]);
  });

  it("captures the full multi-line range for object-form steps", () => {
    const yaml = `appId: x
---
- assertVisible:
    text: "Summarize text"
- assertVisible:
    text: "Get advice"
`;
    const ast = parseFlow(yaml);
    expect(ast.steps).toEqual([
      { index: 0, line: 3, endLine: 4, command: "assertVisible", arg: "Summarize text" },
      { index: 1, line: 5, endLine: 6, command: "assertVisible", arg: "Get advice" },
    ]);
  });

  it("indexes by command|arg in byKey", () => {
    const yaml = `appId: x
---
- tapOn: "Login"
- tapOn: "Login"
- tapOn: "Submit"
`;
    const ast = parseFlow(yaml);
    expect(ast.byKey.get("tapOn|Login")).toEqual([0, 1]);
    expect(ast.byKey.get("tapOn|Submit")).toEqual([2]);
  });

  it("returns empty AST on invalid YAML without throwing", () => {
    const ast = parseFlow("appId: x\n---\n- tapOn: [unclosed");
    expect(ast.steps).toEqual([]);
    expect(ast.byKey.size).toBe(0);
  });

  it("handles a flow with no header (single doc)", () => {
    const yaml = `- launchApp\n- tapOn: "X"\n`;
    const ast = parseFlow(yaml);
    expect(ast.steps).toEqual([
      { index: 0, line: 1, endLine: 1, command: "launchApp", arg: null },
      { index: 1, line: 2, endLine: 2, command: "tapOn", arg: "X" },
    ]);
  });

  it("extracts the .id field as the arg for object-form commands when no primary string arg exists", () => {
    const yaml = `appId: x
---
- tapOn:
    id: "login_btn"
`;
    const ast = parseFlow(yaml);
    expect(ast.steps[0]).toMatchObject({ command: "tapOn", arg: "login_btn" });
  });

  it("uses the package name as arg for launchApp object form", () => {
    const yaml = `appId: x
---
- launchApp:
    appId: "com.example.foo"
`;
    const ast = parseFlow(yaml);
    expect(ast.steps[0]).toMatchObject({ command: "launchApp", arg: "com.example.foo" });
  });
});
