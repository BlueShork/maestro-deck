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
}));
