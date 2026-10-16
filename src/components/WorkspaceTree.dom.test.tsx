import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { snapshotOf } from "@/test/snapshot";
import type { WorkspaceNode } from "@/types";

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
  listWorkspace: vi.fn(),
  exists: vi.fn(),
  ask: vi.fn(),
  message: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: h.exists,
  readTextFile: async (p: string) => {
    const t = h.files.get(p);
    if (t === undefined) throw new Error(`missing ${p}`);
    return t;
  },
  writeTextFile: async (p: string, c: string) => void h.files.set(p, c),
  mkdir: vi.fn(async () => {}),
  remove: h.remove,
  rename: h.rename,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: h.ask,
  message: h.message,
  save: vi.fn(async () => null),
  open: vi.fn(async () => null),
}));
vi.mock("@/lib/ipc", () => ({ ipc: { listWorkspace: h.listWorkspace } }));

import { useFlowStore } from "@/stores/flowStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

import { WorkspaceTree } from "./WorkspaceTree";

const file = (path: string): WorkspaceNode => ({
  kind: "file",
  name: path.split("/").pop()!,
  path,
});
const dir = (path: string, children: WorkspaceNode[]): WorkspaceNode => ({
  kind: "dir",
  name: path.split("/").pop()!,
  path,
  children,
});

const TREE = dir("/ws", [
  dir("/ws/auth", [
    file("/ws/auth/login.yaml"),
    dir("/ws/auth/deep", [file("/ws/auth/deep/x.yaml")]),
  ]),
  file("/ws/smoke.yaml"),
]);

async function mount() {
  const r = render(<WorkspaceTree />);
  await screen.findByText("smoke.yaml");
  return r;
}

beforeEach(() => {
  h.files = new Map([
    ["/ws/smoke.yaml", "- launchApp\n"],
    ["/ws/auth/login.yaml", "- tapOn: Login\n"],
  ]);
  h.listWorkspace.mockReset().mockResolvedValue(TREE);
  h.exists.mockReset().mockImplementation(async (p: string) => p === "/ws/config.yaml");
  h.ask.mockReset().mockResolvedValue(true);
  h.message.mockReset().mockResolvedValue("Cancel");
  h.remove.mockReset().mockResolvedValue(undefined);
  h.rename.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({ autoSaveEnabled: false });
  useWorkspaceStore.setState({
    folderPath: "/ws",
    tree: null,
    expanded: {},
    loading: false,
    error: null,
    hasConfig: false,
    lastOpenFile: null,
  });
  useFlowStore.setState({ content: "", filePath: null, dirty: false });
});
afterEach(cleanup);

describe("WorkspaceTree", () => {
  it("invites opening a folder when none is open", () => {
    useWorkspaceStore.setState({ folderPath: null });
    render(<WorkspaceTree />);
    expect(screen.getByText("Open a folder to browse your Maestro flows.")).toBeTruthy();
    expect(h.listWorkspace).not.toHaveBeenCalled();
  });

  it("lists the folder, top-level folders expanded and nested ones collapsed", async () => {
    await mount();
    expect(screen.getByText("login.yaml")).toBeTruthy();
    expect(screen.getByText("deep")).toBeTruthy();
    expect(screen.queryByText("x.yaml")).toBeNull();
    fireEvent.click(screen.getByText("deep"));
    expect(screen.getByText("x.yaml")).toBeTruthy();
    expect(useWorkspaceStore.getState().expanded["/ws/auth/deep"]).toBe(true);
  });

  it("flags a config.yaml at the root", async () => {
    await mount();
    expect(screen.getByTitle(/config.yaml found/)).toBeTruthy();
  });

  it("shows a listing error", async () => {
    h.listWorkspace.mockRejectedValue(new Error("permission denied"));
    render(<WorkspaceTree />);
    expect(await screen.findByText("permission denied")).toBeTruthy();
  });

  it("opens a flow on click and marks it active", async () => {
    await mount();
    fireEvent.click(screen.getByText("smoke.yaml"));
    await waitFor(() => expect(useFlowStore.getState().filePath).toBe("/ws/smoke.yaml"));
    expect(useFlowStore.getState().content).toBe("- launchApp\n");
    expect(screen.getByText("smoke.yaml").closest("div")!.className).toContain("bg-accent");
  });

  it("asks before replacing unsaved edits, and keeps them on Cancel", async () => {
    useFlowStore.setState({ content: "edits\n", filePath: "/ws/auth/login.yaml", dirty: true });
    await mount();
    fireEvent.click(screen.getByText("smoke.yaml"));
    await waitFor(() => expect(h.message).toHaveBeenCalledOnce());
    expect(useFlowStore.getState()).toMatchObject({
      content: "edits\n",
      filePath: "/ws/auth/login.yaml",
    });
  });

  it("creates a flow from the header's + button", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "New flow" }));
    const input = screen.getByPlaceholderText("flow-name.yaml");
    fireEvent.change(input, { target: { value: "checkout" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(h.files.has("/ws/checkout.yaml")).toBe(true));
    await waitFor(() => expect(useFlowStore.getState().filePath).toBe("/ws/checkout.yaml"));
  });

  it("Escape or an empty blur cancels the new-flow input without creating anything", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "New flow" }));
    fireEvent.keyDown(screen.getByPlaceholderText("flow-name.yaml"), { key: "Escape" });
    expect(screen.queryByPlaceholderText("flow-name.yaml")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New flow" }));
    fireEvent.blur(screen.getByPlaceholderText("flow-name.yaml"));
    expect(screen.queryByPlaceholderText("flow-name.yaml")).toBeNull();
    expect([...h.files.keys()]).toHaveLength(2);
  });

  it("creates a flow inside a folder from its hover button", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "New flow in auth" }));
    const input = screen.getByPlaceholderText("flow-name.yaml");
    fireEvent.change(input, { target: { value: "signup.yaml" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(h.files.has("/ws/auth/signup.yaml")).toBe(true));
  });

  it("deletes a flow from its trash button after confirmation", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Delete smoke.yaml" }));
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith("/ws/smoke.yaml", undefined));
  });

  it("does not delete when the confirmation is declined", async () => {
    h.ask.mockResolvedValue(false);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Delete smoke.yaml" }));
    await waitFor(() => expect(h.ask).toHaveBeenCalled());
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("closing the workspace returns to the empty state", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Close workspace" }));
    expect(useWorkspaceStore.getState().folderPath).toBeNull();
    expect(screen.getByText("No folder open")).toBeTruthy();
  });

  it("a listing that resolves after switching folders is discarded", async () => {
    let releaseOld!: (t: WorkspaceNode) => void;
    h.listWorkspace.mockReset();
    h.listWorkspace
      .mockReturnValueOnce(new Promise((r) => (releaseOld = r)))
      .mockResolvedValueOnce(dir("/other", [file("/other/new.yaml")]));
    render(<WorkspaceTree />);
    act(() => useWorkspaceStore.getState().setFolder("/other"));
    expect(await screen.findByText("new.yaml")).toBeTruthy();
    await act(async () => releaseOld(TREE));
    expect(screen.queryByText("smoke.yaml")).toBeNull();
    expect(screen.getByText("new.yaml")).toBeTruthy();
  });

  it("snapshot: a listed workspace with the open flow highlighted", async () => {
    useFlowStore.setState({ filePath: "/ws/auth/login.yaml" });
    const { container } = await mount();
    expect(snapshotOf(container.firstElementChild)).toMatchSnapshot();
  });
});
