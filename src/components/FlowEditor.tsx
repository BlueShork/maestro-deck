import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  StreamLanguage,
} from "@codemirror/language";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import {
  Compartment,
  EditorState,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutterLineClass,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { FileDown, FileUp, Save } from "lucide-react";
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { parseFlow } from "@/lib/flowAst";
import maestroCommands from "@/lib/maestro-commands.json";

import { Button } from "@/components/ui/Button";
import { themeExtensions } from "@/lib/editor-theme";
import { openFlowFile } from "@/lib/flow-io";
import { resolveTheme } from "@/lib/theme";
import { useAutosave } from "@/lib/useAutosave";
import { useFlowStore } from "@/stores/flowStore";
import { useRunStore } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { toast } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

function maestroCompletions(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/[\w-]*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return {
    from: word.from,
    options: maestroCommands.map(({ label, info }) => ({
      label,
      type: "keyword",
      detail: "maestro",
      description: info,
    })) as unknown as CompletionResult["options"],
  };
}

function renderCompletionDescription(completion: { description?: string }): Node | null {
  if (!completion.description) return null;
  const el = document.createElement("div");
  el.className = "cm-completionDescription";
  el.textContent = completion.description;
  return el;
}

const setActiveLine = StateEffect.define<number | null>();

type StepStatus = "running" | "done" | "failed";
type StepStatusMap = Map<number, { status: StepStatus; endLine: number }>;

const setStepStatuses = StateEffect.define<StepStatusMap>();

const stepStatusField = StateField.define<StepStatusMap>({
  create: () => new Map(),
  update(map, tr) {
    for (const e of tr.effects) {
      if (e.is(setStepStatuses)) return e.value;
    }
    return map;
  },
});

class StepLineMarker extends GutterMarker {
  override elementClass: string;
  constructor(readonly status: StepStatus) {
    super();
    this.elementClass = `cm-step-line-${status}`;
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof StepLineMarker && other.status === this.status;
  }
}

const stepLineClassExt = gutterLineClass.compute([stepStatusField], (state) => {
  const map = state.field(stepStatusField);
  if (map.size === 0) return RangeSet.empty;
  const builder = new RangeSetBuilder<GutterMarker>();
  const sorted = [...map.entries()].sort((a, b) => a[0] - b[0]);
  const totalLines = state.doc.lines;
  for (const [startLine, { status, endLine }] of sorted) {
    const from = Math.max(1, startLine);
    const to = Math.min(totalLines, Math.max(endLine, startLine));
    if (from > totalLines) continue;
    const marker = new StepLineMarker(status);
    for (let ln = from; ln <= to; ln++) {
      const pos = state.doc.line(ln).from;
      builder.add(pos, pos, marker);
    }
  }
  return builder.finish();
});

const activeLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setActiveLine)) {
        if (e.value === null || e.value < 1) return Decoration.none;
        const line = tr.state.doc.line(Math.min(e.value, tr.state.doc.lines));
        return Decoration.set([Decoration.line({ class: "cm-active-run-line" }).range(line.from)]);
      }
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function FlowEditor({ onRunFrom }: { onRunFrom?: (line: number) => void } = {}) {
  const content = useFlowStore((s) => s.content);
  const filePath = useFlowStore((s) => s.filePath);
  const dirty = useFlowStore((s) => s.dirty);
  const activeLine = useFlowStore((s) => s.activeLine);
  const steps = useRunStore((s) => s.steps);
  const setContent = useFlowStore((s) => s.setContent);
  const setCursor = useFlowStore((s) => s.setCursor);
  const saved = useFlowStore((s) => s.saved);
  useAutosave();

  const themeMode = useSettingsStore((s) => s.theme);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const syncingFromStore = useRef(false);

  const [menu, setMenu] = useState<{ x: number; y: number; line: number } | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: content,
      extensions: [
        stepStatusField,
        stepLineClassExt,
        lineNumbers(),
        foldGutter({ markerDOM: () => document.createElement("span") }),
        history(),
        indentOnInput(),
        indentUnit.of("  "),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        autocompletion({
          override: [maestroCompletions],
          icons: false,
          activateOnTyping: true,
          addToOptions: [
            {
              render: (completion) =>
                renderCompletionDescription(completion as { description?: string }),
              position: 90,
            },
          ],
        }),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        StreamLanguage.define(yaml),
        themeCompartment.current.of(themeExtensions(resolveTheme(themeMode))),
        activeLineField,
        EditorView.lineWrapping,
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
    // Focus on mount so the caret is visible (otherwise no animation).
    view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once; content sync handled in the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const map: StepStatusMap = new Map();
    for (const s of steps) {
      if (s.status === "running" || s.status === "done" || s.status === "failed") {
        map.set(s.line, { status: s.status, endLine: s.endLine });
      }
    }
    view.dispatch({ effects: setStepStatuses.of(map) });
  }, [steps]);

  // Swap CodeMirror theme when settings change (also re-applies when the
  // OS switches between light/dark under "system" mode because resolveTheme
  // re-reads the media query).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const apply = () =>
      view.dispatch({
        effects: themeCompartment.current.reconfigure(themeExtensions(resolveTheme(themeMode))),
      });
    apply();
    if (themeMode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => apply();
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [themeMode]);

  const onEditorContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!onRunFrom) return;
      const view = viewRef.current;
      if (!view) return;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return;
      const clickedLine = view.state.doc.lineAt(pos).number;
      const ast = parseFlow(view.state.doc.toString());
      const target = ast.steps.find((s) => s.line >= clickedLine);
      if (!target) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, line: target.line });
    },
    [onRunFrom],
  );

  const onOpen = useCallback(async () => {
    try {
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: "Maestro flow", extensions: ["yaml", "yml"] }],
      });
      if (typeof picked !== "string") return;
      const ok = await openFlowFile(picked);
      if (ok) toast.success("Flow loaded", picked);
    } catch (err) {
      toast.error("Open failed", err instanceof Error ? err.message : String(err));
    }
  }, []);

  const onSaveAs = useCallback(async () => {
    try {
      const picked = await saveDialog({
        filters: [{ name: "Maestro flow", extensions: ["yaml", "yml"] }],
      });
      if (!picked) return;
      await writeTextFile(picked, content);
      saved(picked);
      useWorkspaceStore.getState().setLastOpenFile(picked);
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
      useWorkspaceStore.getState().setLastOpenFile(filePath);
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
          <span className="truncate text-xs font-medium tracking-tight">
            {filePath ? filePath.split(/[\\/]/).pop() : "Untitled.yaml"}
          </span>
          {dirty ? (
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_hsl(45_100%_60%/0.5)]" />
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
      <div
        ref={hostRef}
        className="min-h-0 flex-1 overflow-hidden"
        onContextMenu={onEditorContextMenu}
      />
      {menu && onRunFrom ? (
        <DropdownMenu open onOpenChange={(open) => !open && setMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden
              style={{
                position: "fixed",
                left: menu.x,
                top: menu.y,
                width: 0,
                height: 0,
                pointerEvents: "none",
              }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={0}>
            <DropdownMenuItem
              onSelect={() => {
                const line = menu.line;
                setMenu(null);
                onRunFrom(line);
              }}
            >
              Run from line {menu.line}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
