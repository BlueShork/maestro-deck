import Editor, { loader, type OnMount } from "@monaco-editor/react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { FileDown, FileUp, Save } from "lucide-react";
import * as monaco from "monaco-editor";
import type { editor as MonacoEditor } from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import yamlWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { useCallback, useEffect, useRef } from "react";

// Use the bundled monaco-editor package instead of the default CDN loader.
// Release builds run inside a Tauri webview with a strict CSP that blocks
// cross-origin script loads — without this line the editor just shows
// "Loading…" forever.
loader.config({ monaco });

// Monaco needs a worker factory at runtime. Vite's `?worker` import bundles
// each worker as a separate chunk and returns a Worker constructor.
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "yaml" || label === "json") return new yamlWorker();
    return new editorWorker();
  },
};

import { Button } from "@/components/ui/Button";
import { useFlowStore } from "@/stores/flowStore";
import { toast } from "@/stores/toastStore";

const MAESTRO_KEYWORDS = [
  "launchApp",
  "tapOn",
  "inputText",
  "assertVisible",
  "assertNotVisible",
  "scroll",
  "scrollUntilVisible",
  "back",
  "hideKeyboard",
  "pressKey",
  "waitForAnimationToEnd",
  "swipe",
  "openLink",
  "stopApp",
  "clearState",
  "takeScreenshot",
];

export function FlowEditor() {
  const content = useFlowStore((s) => s.content);
  const filePath = useFlowStore((s) => s.filePath);
  const dirty = useFlowStore((s) => s.dirty);
  const activeLine = useFlowStore((s) => s.activeLine);
  const setContent = useFlowStore((s) => s.setContent);
  const setCursor = useFlowStore((s) => s.setCursor);
  const loaded = useFlowStore((s) => s.loaded);
  const saved = useFlowStore((s) => s.saved);

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<string[]>([]);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      // Force a layout pass on the next frame: Monaco otherwise caches stale
      // width measurements from before the flex container settled, producing
      // overlapping glyphs in release builds.
      requestAnimationFrame(() => editor.layout());
      monaco.languages.registerCompletionItemProvider("yaml", {
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          return {
            suggestions: MAESTRO_KEYWORDS.map((kw) => ({
              label: kw,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: kw,
              range,
            })),
          };
        },
      });
      editor.onDidChangeCursorPosition((e) => {
        setCursor(e.position.lineNumber, e.position.column);
      });
    },
    [setCursor],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (activeLine === null) {
      decorationsRef.current = editor.deltaDecorations(
        decorationsRef.current,
        [],
      );
      return;
    }
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [
      {
        range: {
          startLineNumber: activeLine,
          endLineNumber: activeLine,
          startColumn: 1,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className: "bg-primary/10",
          glyphMarginClassName: "border-l-2 border-primary",
        },
      },
    ]);
  }, [activeLine]);

  const onOpen = useCallback(async () => {
    try {
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: "Maestro flow", extensions: ["yaml", "yml"] }],
      });
      if (typeof picked !== "string") return;
      const text = await readTextFile(picked);
      loaded(text, picked);
      toast.success("Flow loaded", picked);
    } catch (err) {
      toast.error("Open failed", err instanceof Error ? err.message : String(err));
    }
  }, [loaded]);

  const onSaveAs = useCallback(async () => {
    try {
      const picked = await saveDialog({
        filters: [{ name: "Maestro flow", extensions: ["yaml", "yml"] }],
      });
      if (!picked) return;
      await writeTextFile(picked, content);
      saved(picked);
      toast.success("Saved", picked);
    } catch (err) {
      toast.error("Save failed", err instanceof Error ? err.message : String(err));
    }
  }, [content, saved]);

  const onSave = useCallback(async () => {
    if (!filePath) {
      await onSaveAs();
      return;
    }
    try {
      await writeTextFile(filePath, content);
      saved(filePath);
      toast.success("Saved", filePath);
    } catch (err) {
      toast.error("Save failed", err instanceof Error ? err.message : String(err));
    }
  }, [filePath, content, saved, onSaveAs]);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<"save" | "save-as" | "open">;
      if (ce.detail === "save") void onSave();
      else if (ce.detail === "save-as") void onSaveAs();
      else if (ce.detail === "open") void onOpen();
    };
    window.addEventListener("flow:command", handler as EventListener);
    return () =>
      window.removeEventListener("flow:command", handler as EventListener);
  }, [onSave, onSaveAs, onOpen]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium">
            {filePath ? filePath.split(/[\\/]/).pop() : "Untitled.yaml"}
          </span>
          {dirty ? (
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={() => void onOpen()}>
            <FileUp className="h-3.5 w-3.5" />
            Open
          </Button>
          <Button size="xs" variant="ghost" onClick={() => void onSave()}>
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
          <Button size="xs" variant="ghost" onClick={() => void onSaveAs()}>
            <FileDown className="h-3.5 w-3.5" />
            Save As
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          language="yaml"
          theme="vs-dark"
          value={content}
          onChange={(v) => setContent(v ?? "")}
          onMount={handleMount}
          options={{
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 12,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
            scrollBeyondLastLine: false,
            renderLineHighlight: "line",
            tabSize: 2,
            wordWrap: "on",
            glyphMargin: true,
          }}
        />
      </div>
    </div>
  );
}
