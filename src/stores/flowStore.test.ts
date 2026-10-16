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
  });
});

describe("appendAction", () => {
  it("appends at the end when the cursor is still in the header", () => {
    useFlowStore.getState().appendAction('- assertVisible: "OK"');
    expect(useFlowStore.getState().content).toBe(
      'appId: com.example.app\n---\n- launchApp\n- tapOn: "Login"\n- assertVisible: "OK"\n',
    );
  });

  it("appends at the end when the cursor is on the --- separator itself", () => {
    useFlowStore.getState().setCursor(2, 1);
    useFlowStore.getState().appendAction("- back");
    expect(useFlowStore.getState().content).toBe(`${BASE}- back\n`);
  });

  it("moves the cursor to the snippet when appending at the end", () => {
    useFlowStore.setState({ content: `appId: x\n---\n${"- back\n".repeat(200)}` });
    useFlowStore.getState().appendAction('- assertVisible: "OK"');
    // The snippet lands on line 203; the cursor must follow it so the editor
    // reveals the insertion point instead of jumping back to line 1.
    expect(useFlowStore.getState().cursorLine).toBe(203);
  });

  it("advances the cursor past a multi-line snippet appended at the end", () => {
    useFlowStore.getState().appendAction('- scrollUntilVisible:\n    element: "OK"');
    expect(useFlowStore.getState().cursorLine).toBe(6);
  });

  it("inserts on a new line after the cursor line, wherever it was left", () => {
    useFlowStore.getState().setCursor(3, 5);
    useFlowStore.getState().appendAction('- assertVisible: "OK"');
    expect(useFlowStore.getState().content).toBe(
      'appId: com.example.app\n---\n- launchApp\n- assertVisible: "OK"\n- tapOn: "Login"\n',
    );
  });

  it("keeps using the last cursor position across repeated inserts", () => {
    // The inspector never touches the editor, so the caret stays put between
    // right-clicks and every insert must chain from it, not from the file end.
    useFlowStore.getState().setCursor(3, 1);
    useFlowStore.getState().appendAction("- back");
    useFlowStore.getState().appendAction('- inputText: "hi"');
    expect(useFlowStore.getState().content).toBe(
      'appId: com.example.app\n---\n- launchApp\n- back\n- inputText: "hi"\n- tapOn: "Login"\n',
    );
    expect(useFlowStore.getState().cursorLine).toBe(5);
  });

  it("advances the cursor past multi-line snippets", () => {
    useFlowStore.getState().setCursor(3, 1);
    useFlowStore.getState().appendAction('- scrollUntilVisible:\n    element: "OK"');
    expect(useFlowStore.getState().cursorLine).toBe(5);
  });

  it("clamps an out-of-range cursor line to the last line", () => {
    useFlowStore.getState().setCursor(99, 1);
    useFlowStore.getState().appendAction("- back");
    expect(useFlowStore.getState().content).toBe(`${BASE}- back\n`);
  });

  it("appends at the end of a flow that has no --- separator", () => {
    useFlowStore.setState({ content: "- launchApp\n- back\n", cursorLine: 1 });
    useFlowStore.getState().appendAction('- assertVisible: "OK"');
    // No header to protect: line 1 is a real step, so the snippet follows it.
    expect(useFlowStore.getState().content).toBe('- launchApp\n- assertVisible: "OK"\n- back\n');
  });

  it("resets the cursor to the top when a file is loaded", () => {
    useFlowStore.getState().setCursor(200, 3);
    useFlowStore.getState().loaded("appId: x\n---\n- launchApp\n", "/tmp/f.yaml");
    // A stale cursorLine would make the editor park the caret — and now scroll —
    // partway into a freshly opened file instead of showing its top.
    expect(useFlowStore.getState().cursorLine).toBe(1);
    expect(useFlowStore.getState().cursorColumn).toBe(1);
  });

  it("sends the first insert after a load to the end of the flow", () => {
    useFlowStore.getState().setCursor(3, 1);
    useFlowStore.getState().loaded("appId: x\n---\n- launchApp\n", "/tmp/f.yaml");
    useFlowStore.getState().appendAction("- back");
    expect(useFlowStore.getState().content).toBe("appId: x\n---\n- launchApp\n- back\n");
  });
});

describe("saved", () => {
  it("clears dirty and records the path", () => {
    useFlowStore.setState({ dirty: true });
    useFlowStore.getState().saved("/tmp/a.yaml");
    expect(useFlowStore.getState()).toMatchObject({ filePath: "/tmp/a.yaml", dirty: false });
  });

  it("clears dirty when the written content is still the buffer", () => {
    useFlowStore.getState().setContent("- back\n");
    useFlowStore.getState().saved("/tmp/a.yaml", "- back\n");
    expect(useFlowStore.getState().dirty).toBe(false);
  });

  it("stays dirty when the buffer changed while the write was in flight", () => {
    useFlowStore.getState().setContent("- back\n");
    const written = useFlowStore.getState().content;
    useFlowStore.getState().setContent("- back\n- launchApp\n");
    useFlowStore.getState().saved("/tmp/a.yaml", written);
    expect(useFlowStore.getState()).toMatchObject({ filePath: "/tmp/a.yaml", dirty: true });
  });
});

describe("setContent", () => {
  it("marks the buffer dirty only when the text actually changes", () => {
    useFlowStore.getState().setContent(BASE);
    expect(useFlowStore.getState().dirty).toBe(false);
    useFlowStore.getState().setContent(`${BASE}- back\n`);
    expect(useFlowStore.getState().dirty).toBe(true);
  });

  it("keeps an existing dirty flag when set to identical text", () => {
    useFlowStore.setState({ dirty: true });
    useFlowStore.getState().setContent(BASE);
    expect(useFlowStore.getState().dirty).toBe(true);
  });
});

describe("insertAtCursor", () => {
  it("inserts at the cursor column of the cursor line", () => {
    useFlowStore.getState().setCursor(4, 10);
    useFlowStore.getState().insertAtCursor("Big ");
    expect(useFlowStore.getState().content).toBe(
      'appId: com.example.app\n---\n- launchApp\n- tapOn: Big "Login"\n',
    );
    expect(useFlowStore.getState().dirty).toBe(true);
  });

  it("clamps a column past the end of the line to the line end", () => {
    useFlowStore.getState().setCursor(3, 500);
    useFlowStore.getState().insertAtCursor("!");
    expect(useFlowStore.getState().content.split("\n")[2]).toBe("- launchApp!");
  });

  it("clamps a line past the end of the document to the last line", () => {
    useFlowStore.getState().setCursor(99, 1);
    useFlowStore.getState().insertAtCursor("x");
    expect(useFlowStore.getState().content.endsWith("\nx")).toBe(true);
  });
});
