import {
  autocompletion,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { FileDown, FileUp, Save } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

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

function maestroCompletions(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return {
    from: word.from,
    options: MAESTRO_KEYWORDS.map((label) => ({ label, type: "keyword" })),
  };
}

// Active line highlighting for run-in-progress: the backend emits the line
// number currently executing and we paint it with a subtle background.
const setActiveLine = StateEffect.define<number | null>();

const activeLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setActiveLine)) {
        if (e.value === null || e.value < 1) return Decoration.none;
        const line = tr.state.doc.line(Math.min(e.value, tr.state.doc.lines));
        return Decoration.set([
          Decoration.line({ class: "cm-active-run-line" }).range(line.from),
        ]);
      }
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
  },
  ".cm-scroller": { overflow: "auto" },
  ".cm-active-run-line": {
    backgroundColor: "hsl(var(--primary) / 0.15)",
    borderLeft: "2px solid hsl(var(--primary))",
  },
});

export function FlowEditor() {
  const content = useFlowStore((s) => s.content);
  const filePath = useFlowStore((s) => s.filePath);
  const dirty = useFlowStore((s) => s.dirty);
  const activeLine = useFlowStore((s) => s.activeLine);
  const setContent = useFlowStore((s) => s.setContent);
  const setCursor = useFlowStore((s) => s.setCursor);
  const loaded = useFlowStore((s) => s.loaded);
  const saved = useFlowStore((s) => s.saved);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const syncingFromStore = useRef(false);
  const readonlyCompartment = useRef(new Compartment()).current;

  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        autocompletion({ override: [maestroCompletions] }),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        StreamLanguage.define(yaml),
        oneDark,
        editorTheme,
        activeLineField,
        readonlyCompartment.of(EditorState.readOnly.of(false)),
        EditorView.updateListener.of((v) => {
          if (v.docChanged && !syncingFromStore.current) {
            setContent(v.state.doc.toString());
          }
          if (v.selectionSet) {
            const head = v.state.selection.main.head;
            const line = v.state.doc.lineAt(head);
            setCursor(line.number, head - line.from + 1);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only mount once; content sync handled in the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pull content from the store when it diverges (file open, external edits).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === content) return;
    syncingFromStore.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
    syncingFromStore.current = false;
  }, [content]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setActiveLine.of(activeLine) });
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
    return () => window.removeEventListener("flow:command", handler as EventListener);
  }, [onSave, onSaveAs, onOpen]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium">
            {filePath ? filePath.split(/[\\/]/).pop() : "Untitled.yaml"}
          </span>
          {dirty ? <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> : null}
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
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  );
}
