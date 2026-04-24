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
   * Append an action at the very end of the file, regardless of where the
   * editor cursor currently is. Used by the inspect-mode right-click
   * menu and the +tap/+assert buttons so captured actions accumulate at
   * the bottom of the flow instead of being wedged between existing
   * instructions at a stale cursor position.
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
  setContent: (content) =>
    set((s) => ({ content, dirty: content !== s.content ? true : s.dirty })),
  loaded: (content, filePath) =>
    set({ content, filePath, dirty: false, activeLine: null }),
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
      // Guarantee exactly one newline between the existing content and
      // the appended snippet, and that the final file ends with a single
      // trailing newline — avoids the snippet being glued onto the last
      // instruction or producing a run of blank lines on repeat inserts.
      const trimmed = s.content.replace(/\s+$/, "");
      const snippet = text.endsWith("\n") ? text : `${text}\n`;
      const content = trimmed.length === 0 ? snippet : `${trimmed}\n${snippet}`;
      return { content, dirty: true };
    }),
}));
