// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { clearIndentOnBlankLine } from "./editorCommands";

function run(doc: string, cursor: number) {
  const state = EditorState.create({ doc, selection: EditorSelection.cursor(cursor) });
  let next: EditorState | null = null;
  const handled = clearIndentOnBlankLine({
    state,
    dispatch: (tr: Transaction) => {
      next = tr.state;
    },
  });
  return { handled, state: next as EditorState | null };
}

describe("clearIndentOnBlankLine", () => {
  it("clears a whitespace-only line and moves the cursor to column 0", () => {
    const doc = '- assertVisible:\n    text: "Maestro Deck"\n    ';
    const { handled, state } = run(doc, doc.length);
    expect(handled).toBe(true);
    expect(state?.doc.toString()).toBe('- assertVisible:\n    text: "Maestro Deck"\n');
    expect(state?.selection.main.head).toBe(state?.doc.length);
  });

  it("does nothing on a line with content (falls through to default Enter)", () => {
    const doc = "- launchApp";
    expect(run(doc, doc.length).handled).toBe(false);
  });

  it("does nothing on an already-empty line", () => {
    const doc = "- launchApp\n";
    expect(run(doc, doc.length).handled).toBe(false);
  });

  it("does nothing when there is a selection", () => {
    const doc = "    ";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.length),
    });
    const handled = clearIndentOnBlankLine({ state, dispatch: () => {} });
    expect(handled).toBe(false);
  });

  it("handles tabs as indentation", () => {
    const doc = "- launchApp\n\t\t";
    const { handled, state } = run(doc, doc.length);
    expect(handled).toBe(true);
    expect(state?.doc.toString()).toBe("- launchApp\n");
  });

  it("works mid-document, not just on the last line", () => {
    const doc = "- launchApp\n    \n- back";
    // cursor at end of the whitespace-only line 2
    const { handled, state } = run(doc, 16);
    expect(handled).toBe(true);
    expect(state?.doc.toString()).toBe("- launchApp\n\n- back");
    expect(state?.selection.main.head).toBe(12);
  });
});
