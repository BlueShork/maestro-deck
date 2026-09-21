// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";

const DEFAULT_YAML = `appId: com.example.app
---
- launchApp
- tapOn: "Login"
- inputText: "user@example.com"
`;

interface FlowState {
  content: string;
  filePath: string | null;
  dirty: boolean;
  activeLine: number | null;
  cursorLine: number;
  cursorColumn: number;
  setContent: (content: string) => void;
  loaded: (content: string, filePath: string) => void;
  saved: (filePath: string) => void;
  setActiveLine: (line: number | null) => void;
  setCursor: (line: number, column: number) => void;
  insertAtCursor: (text: string) => void;
  /**
   * Insert an action snippet into the flow, on a new line right after the
   * cursor line, advancing the cursor past it so successive inserts land in
   * document order. The caret is the only thing that decides placement —
   * inserts come from outside the editor (the inspect-mode right-click menu,
   * the +tap/+assert buttons), so the last cursor position is the user's
   * standing answer to "where does this go".
   *
   * One exception: a caret still in the YAML header (at or above the `---`
   * separator) can't take an action after it, so the snippet goes to the end
   * of the flow instead. That covers a freshly loaded file nobody has clicked
   * into yet, and keeps the record-as-you-tap workflow accumulating downward.
   */
  appendAction: (text: string) => void;
}

/**
 * Line number of the last `---` document separator, or 0 when the flow has
 * none. Matches splitDocs() in flowAst.ts: a separator is a line that is
 * exactly `---` once trimmed.
 */
function separatorLine(lines: string[]): number {
  let last = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "---") last = i + 1;
  }
  return last;
}

export const useFlowStore = create<FlowState>((set) => ({
  content: DEFAULT_YAML,
  filePath: null,
  dirty: false,
  activeLine: null,
  cursorLine: 1,
  cursorColumn: 1,
  setContent: (content) => set((s) => ({ content, dirty: content !== s.content ? true : s.dirty })),
  loaded: (content, filePath) =>
    set({
      content,
      filePath,
      dirty: false,
      activeLine: null,
      // Send the caret back to the top: the editor's content sync parks it at
      // cursorLine and scrolls there, so a value left over from the previous
      // file would open this one partway down. Landing in the header also
      // means the first insert goes to the end of the flow.
      cursorLine: 1,
      cursorColumn: 1,
    }),
  saved: (filePath) => set({ filePath, dirty: false }),
  setActiveLine: (line) => set({ activeLine: line }),
  setCursor: (line, column) => set({ cursorLine: line, cursorColumn: column }),
  insertAtCursor: (text) =>
    set((s) => {
      const lines = s.content.split("\n");
      const idx = Math.max(0, Math.min(lines.length - 1, s.cursorLine - 1));
      const line = lines[idx] ?? "";
      const col = Math.max(0, Math.min(line.length, s.cursorColumn - 1));
      lines[idx] = line.slice(0, col) + text + line.slice(col);
      return { content: lines.join("\n"), dirty: true };
    }),
  appendAction: (text) =>
    set((s) => {
      // Guarantee the snippet ends with exactly one newline.
      const snippet = text.endsWith("\n") ? text : `${text}\n`;
      const lines = s.content.split("\n");
      // Drop the empty element produced by a trailing newline so the
      // snippet never lands after a phantom blank line.
      if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
      // A caret in the header has no valid "after me" — fall back to the end
      // of the flow, which is also where record-as-you-tap wants it.
      const target = s.cursorLine <= separatorLine(lines) ? lines.length : s.cursorLine;
      const idx = Math.max(0, Math.min(lines.length - 1, target - 1));
      const snippetLines = snippet.replace(/\n$/, "").split("\n");
      lines.splice(idx + 1, 0, ...snippetLines);
      return {
        content: `${lines.join("\n")}\n`,
        dirty: true,
        // Advance past the inserted lines so repeat inserts chain in order.
        cursorLine: idx + 1 + snippetLines.length,
      };
    }),
}));
