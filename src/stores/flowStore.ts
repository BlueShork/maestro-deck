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
  /**
   * True once the user has deliberately placed the cursor in the editor
   * (click, keyboard move, typing). Reset when a file is loaded. Gates
   * whether appendAction targets the cursor or the end of the file.
   */
  cursorPlaced: boolean;
  setContent: (content: string) => void;
  loaded: (content: string, filePath: string) => void;
  saved: (filePath: string) => void;
  setActiveLine: (line: number | null) => void;
  setCursor: (line: number, column: number, userDriven?: boolean) => void;
  insertAtCursor: (text: string) => void;
  /**
   * Insert an action snippet into the flow. If the user has placed the
   * cursor in the editor (`cursorPlaced`), the snippet goes on a new line
   * right after the cursor line and the cursor advances past it, so
   * successive inserts land in document order. Otherwise the snippet is
   * appended at the very end of the file. Used by the inspect-mode
   * right-click menu and the +tap/+assert buttons.
   */
  appendAction: (text: string) => void;
}

export const useFlowStore = create<FlowState>((set) => ({
  content: DEFAULT_YAML,
  filePath: null,
  dirty: false,
  activeLine: null,
  cursorLine: 1,
  cursorColumn: 1,
  cursorPlaced: false,
  setContent: (content) => set((s) => ({ content, dirty: content !== s.content ? true : s.dirty })),
  loaded: (content, filePath) =>
    set({ content, filePath, dirty: false, activeLine: null, cursorPlaced: false }),
  saved: (filePath) => set({ filePath, dirty: false }),
  setActiveLine: (line) => set({ activeLine: line }),
  setCursor: (line, column, userDriven = false) =>
    set((s) => ({
      cursorLine: line,
      cursorColumn: column,
      cursorPlaced: s.cursorPlaced || userDriven,
    })),
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
      if (!s.cursorPlaced) {
        // No cursor placed since load: accumulate at the bottom of the
        // flow, with exactly one newline between existing content and
        // snippet and a single trailing newline.
        const trimmed = s.content.replace(/\s+$/, "");
        const content = trimmed.length === 0 ? snippet : `${trimmed}\n${snippet}`;
        return { content, dirty: true };
      }
      const lines = s.content.split("\n");
      // Drop the empty element produced by a trailing newline so the
      // snippet never lands after a phantom blank line.
      if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
      const idx = Math.max(0, Math.min(lines.length - 1, s.cursorLine - 1));
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
