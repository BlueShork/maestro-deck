// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { beforeEach, describe, expect, it } from "vitest";

import { useFlowStore } from "./flowStore";

const BASE = 'appId: com.example.app\n---\n- launchApp\n- tapOn: "Login"\n';

beforeEach(() => {
  useFlowStore.setState({
    content: BASE,
    filePath: null,
    dirty: false,
    activeLine: null,
    cursorLine: 1,
    cursorColumn: 1,
    cursorPlaced: false,
  });
});

describe("appendAction", () => {
  it("appends at the end when no cursor was placed", () => {
    useFlowStore.getState().appendAction('- assertVisible: "OK"');
    expect(useFlowStore.getState().content).toBe(
      'appId: com.example.app\n---\n- launchApp\n- tapOn: "Login"\n- assertVisible: "OK"\n',
    );
  });

  it("ignores non-user cursor sync (userDriven omitted)", () => {
    useFlowStore.getState().setCursor(3, 1);
    useFlowStore.getState().appendAction('- assertVisible: "OK"');
    expect(useFlowStore.getState().content).toBe(
      'appId: com.example.app\n---\n- launchApp\n- tapOn: "Login"\n- assertVisible: "OK"\n',
    );
    expect(useFlowStore.getState().cursorPlaced).toBe(false);
  });

  it("inserts on a new line after the cursor line when the cursor was placed", () => {
    useFlowStore.getState().setCursor(3, 5, true);
    useFlowStore.getState().appendAction('- assertVisible: "OK"');
    expect(useFlowStore.getState().content).toBe(
      'appId: com.example.app\n---\n- launchApp\n- assertVisible: "OK"\n- tapOn: "Login"\n',
    );
  });

  it("chains successive insertions in document order", () => {
    useFlowStore.getState().setCursor(3, 1, true);
    useFlowStore.getState().appendAction("- back");
    useFlowStore.getState().appendAction('- inputText: "hi"');
    expect(useFlowStore.getState().content).toBe(
      'appId: com.example.app\n---\n- launchApp\n- back\n- inputText: "hi"\n- tapOn: "Login"\n',
    );
    expect(useFlowStore.getState().cursorLine).toBe(5);
  });

  it("advances the cursor past multi-line snippets", () => {
    useFlowStore.getState().setCursor(3, 1, true);
    useFlowStore.getState().appendAction('- scrollUntilVisible:\n    element: "OK"');
    expect(useFlowStore.getState().cursorLine).toBe(5);
  });

  it("clamps an out-of-range cursor line to the last line", () => {
    useFlowStore.getState().setCursor(99, 1, true);
    useFlowStore.getState().appendAction("- back");
    expect(useFlowStore.getState().content).toBe(`${BASE}- back\n`);
  });

  it("resets cursorPlaced when a file is loaded", () => {
    useFlowStore.getState().setCursor(3, 1, true);
    useFlowStore.getState().loaded("appId: x\n---\n- launchApp\n", "/tmp/f.yaml");
    useFlowStore.getState().appendAction("- back");
    expect(useFlowStore.getState().content).toBe("appId: x\n---\n- launchApp\n- back\n");
  });
});
