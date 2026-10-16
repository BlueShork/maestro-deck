import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no Range layout; CodeMirror's deferred measure would throw an
// uncaught error after the test that triggered it and fail the run.
Range.prototype.getClientRects = () =>
  ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: [][Symbol.iterator],
  }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
  save: vi.fn(),
  open: vi.fn(),
  message: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: async (p: string) => {
    const t = h.files.get(p);
    if (t === undefined) throw new Error(`missing ${p}`);
    return t;
  },
  writeTextFile: async (p: string, c: string) => void h.files.set(p, c),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: h.save, open: h.open, message: h.message }));

import { useFlowStore } from "@/stores/flowStore";
import { useRunStore } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

import { FlowEditor } from "./FlowEditor";

const FLOW = "appId: com.app\n---\n- launchApp\n- tapOn: Login\n";

function view(container: HTMLElement): EditorView {
  const el = container.querySelector(".cm-editor") as HTMLElement;
  const v = EditorView.findFromDOM(el);
  if (!v) throw new Error("no editor");
  return v;
}

const command = (detail: "save" | "save-as" | "open") =>
  act(async () => {
    window.dispatchEvent(new CustomEvent("flow:command", { detail }));
    await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  h.files = new Map([["/ws/other.yaml", "- back\n"]]);
  h.save.mockReset();
  h.open.mockReset();
  h.message.mockReset().mockResolvedValue("Cancel");
  useSettingsStore.setState({ autoSaveEnabled: false });
  useWorkspaceStore.setState({ lastOpenFile: null });
  useRunStore.setState({ steps: [] });
  useFlowStore.setState({
    content: FLOW,
    filePath: "/ws/login.yaml",
    dirty: false,
    activeLine: null,
    cursorLine: 1,
    cursorColumn: 1,
  });
});
afterEach(cleanup);

describe("FlowEditor", () => {
  it("shows the open file's content and name", () => {
    const { container } = render(<FlowEditor />);
    expect(view(container).state.doc.toString()).toBe(FLOW);
    expect(screen.getByText("login.yaml")).toBeTruthy();
    expect(screen.queryByTitle("Unsaved changes")).toBeNull();
  });

  it("an untitled buffer reads Untitled.yaml", () => {
    useFlowStore.setState({ filePath: null });
    render(<FlowEditor />);
    expect(screen.getByText("Untitled.yaml")).toBeTruthy();
  });

  it("typing updates the store and marks the buffer dirty", () => {
    const { container } = render(<FlowEditor />);
    const v = view(container);
    act(() => v.dispatch({ changes: { from: v.state.doc.length, insert: "- back\n" } }));
    expect(useFlowStore.getState()).toMatchObject({ content: `${FLOW}- back\n`, dirty: true });
    expect(screen.getByTitle("Unsaved changes")).toBeTruthy();
  });

  it("moving the caret records the cursor line and column", () => {
    const { container } = render(<FlowEditor />);
    const v = view(container);
    const line4 = v.state.doc.line(4);
    act(() => v.dispatch({ selection: { anchor: line4.from + 3 } }));
    expect(useFlowStore.getState()).toMatchObject({ cursorLine: 4, cursorColumn: 4 });
  });

  it("content changed outside the editor replaces the document without echoing back as an edit", () => {
    const { container } = render(<FlowEditor />);
    act(() => useFlowStore.getState().loaded("- back\n", "/ws/other.yaml"));
    expect(view(container).state.doc.toString()).toBe("- back\n");
    expect(useFlowStore.getState().dirty).toBe(false);
  });

  it("an inserted action parks the caret on it instead of overwriting the store's cursor", () => {
    const { container } = render(<FlowEditor />);
    useFlowStore.getState().setCursor(3, 1);
    act(() => useFlowStore.getState().appendAction("- back"));
    const v = view(container);
    expect(v.state.doc.lineAt(v.state.selection.main.head).number).toBe(4);
    expect(useFlowStore.getState().cursorLine).toBe(4);
  });

  it("Save writes the buffer to its file", async () => {
    useFlowStore.setState({ content: `${FLOW}- back\n`, dirty: true });
    render(<FlowEditor />);
    await command("save");
    expect(h.files.get("/ws/login.yaml")).toBe(`${FLOW}- back\n`);
    expect(useFlowStore.getState().dirty).toBe(false);
    expect(useWorkspaceStore.getState().lastOpenFile).toBe("/ws/login.yaml");
  });

  it("Save on an untitled buffer asks where, then adopts that path", async () => {
    useFlowStore.setState({ filePath: null, dirty: true });
    h.save.mockResolvedValue("/ws/new.yaml");
    render(<FlowEditor />);
    await command("save");
    expect(h.files.get("/ws/new.yaml")).toBe(FLOW);
    expect(useFlowStore.getState()).toMatchObject({ filePath: "/ws/new.yaml", dirty: false });
  });

  it("Save As does nothing when the picker is dismissed", async () => {
    h.save.mockResolvedValue(null);
    render(<FlowEditor />);
    await command("save-as");
    expect(h.files.has("/ws/login.yaml")).toBe(false);
  });

  it("Open loads the picked file", async () => {
    h.open.mockResolvedValue("/ws/other.yaml");
    const { container } = render(<FlowEditor />);
    await command("open");
    expect(useFlowStore.getState().filePath).toBe("/ws/other.yaml");
    expect(view(container).state.doc.toString()).toBe("- back\n");
  });

  it("marks run progress on the step lines", () => {
    const { container } = render(<FlowEditor />);
    act(() =>
      useRunStore.setState({
        steps: [
          {
            index: 0,
            line: 3,
            endLine: 3,
            command: "launchApp",
            arg: null,
            status: "done",
            startedAt: 0,
            durationMs: 1,
            error: null,
          },
          {
            index: 1,
            line: 4,
            endLine: 4,
            command: "tapOn",
            arg: "Login",
            status: "failed",
            startedAt: 0,
            durationMs: 1,
            error: "x",
          },
        ],
      }),
    );
    expect(container.querySelector(".cm-step-line-done")).toBeTruthy();
    expect(container.querySelector(".cm-step-line-failed")).toBeTruthy();
  });

  it("right-click on a step offers 'run from here' for that step", () => {
    const onRunFrom = vi.fn();
    const { container } = render(<FlowEditor onRunFrom={onRunFrom} />);
    const v = view(container);
    vi.spyOn(v, "posAtCoords").mockReturnValue(v.state.doc.line(4).from + 2);
    fireEvent.contextMenu(container.querySelector(".cm-editor")!.parentElement!, {
      clientX: 10,
      clientY: 10,
    });
    const runFrom = screen.getByRole("menuitem", { name: /Run from this step/i });
    fireEvent.click(runFrom);
    expect(onRunFrom).toHaveBeenCalledWith(4);
  });
});
