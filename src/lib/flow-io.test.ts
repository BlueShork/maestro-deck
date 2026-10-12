import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
const dialog = vi.hoisted(() => ({ message: vi.fn(), save: vi.fn(), open: vi.fn() }));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: fs.readTextFile,
  writeTextFile: fs.writeTextFile,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: dialog.message,
  save: dialog.save,
  open: dialog.open,
}));

import { openFlowFile, pickWorkspaceFolder, settleUnsavedFlow, writeFlow } from "./flow-io";
import { useFlowStore } from "@/stores/flowStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useToastStore } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

function openBuffer(content: string, filePath: string | null, dirty: boolean) {
  useFlowStore.setState({ content, filePath, dirty });
}

beforeEach(() => {
  fs.files = new Map([
    ["/ws/a.yaml", "- launchApp\n"],
    ["/ws/b.yaml", "- back\n"],
  ]);
  fs.readTextFile.mockReset().mockImplementation(async (p: string) => {
    const text = fs.files.get(p);
    if (text === undefined) throw new Error(`No such file: ${p}`);
    return text;
  });
  fs.writeTextFile.mockReset().mockImplementation(async (p: string, c: string) => {
    fs.files.set(p, c);
  });
  dialog.message.mockReset();
  dialog.save.mockReset();
  dialog.open.mockReset();
  useSettingsStore.setState({ autoSaveEnabled: false });
  useToastStore.setState({ toasts: [] });
  useWorkspaceStore.setState({ lastOpenFile: null, folderPath: null });
  openBuffer("- launchApp\n", "/ws/a.yaml", false);
});

describe("writeFlow", () => {
  it("writes the buffer and clears dirty", async () => {
    openBuffer("- launchApp\n- back\n", "/ws/a.yaml", true);
    await writeFlow("/ws/a.yaml");
    expect(fs.files.get("/ws/a.yaml")).toBe("- launchApp\n- back\n");
    expect(useFlowStore.getState().dirty).toBe(false);
  });

  it("keeps the buffer dirty when it was edited during the write", async () => {
    openBuffer("v1\n", "/ws/a.yaml", true);
    fs.writeTextFile.mockImplementationOnce(async (p: string, c: string) => {
      useFlowStore.getState().setContent("v2\n");
      fs.files.set(p, c);
    });
    await writeFlow("/ws/a.yaml");
    expect(fs.files.get("/ws/a.yaml")).toBe("v1\n");
    expect(useFlowStore.getState()).toMatchObject({ content: "v2\n", dirty: true });
  });
});

describe("settleUnsavedFlow", () => {
  it("is clean without asking when nothing is unsaved", async () => {
    expect(await settleUnsavedFlow()).toBe("clean");
    expect(dialog.message).not.toHaveBeenCalled();
    expect(fs.writeTextFile).not.toHaveBeenCalled();
  });

  it("writes the edits silently when autosave is on", async () => {
    useSettingsStore.setState({ autoSaveEnabled: true });
    openBuffer("edited\n", "/ws/a.yaml", true);
    expect(await settleUnsavedFlow()).toBe("clean");
    expect(fs.files.get("/ws/a.yaml")).toBe("edited\n");
    expect(dialog.message).not.toHaveBeenCalled();
  });

  it("asks when the autosave write fails, and saving retries", async () => {
    useSettingsStore.setState({ autoSaveEnabled: true });
    openBuffer("edited\n", "/ws/a.yaml", true);
    fs.writeTextFile.mockRejectedValueOnce(new Error("EACCES"));
    dialog.message.mockResolvedValue("Save");
    expect(await settleUnsavedFlow()).toBe("resolved");
    expect(dialog.message).toHaveBeenCalledOnce();
    expect(fs.files.get("/ws/a.yaml")).toBe("edited\n");
  });

  it("names the file and offers Save / Don't Save / Cancel", async () => {
    openBuffer("edited\n", "/ws/a.yaml", true);
    dialog.message.mockResolvedValue("Cancel");
    await settleUnsavedFlow();
    const [text, opts] = dialog.message.mock.calls[0];
    expect(text).toContain('"a.yaml"');
    expect(opts.buttons).toEqual({ yes: "Save", no: "Don't Save", cancel: "Cancel" });
  });

  it("saves to the open file on Save", async () => {
    openBuffer("edited\n", "/ws/a.yaml", true);
    dialog.message.mockResolvedValue("Save");
    expect(await settleUnsavedFlow()).toBe("resolved");
    expect(fs.files.get("/ws/a.yaml")).toBe("edited\n");
    expect(useFlowStore.getState().dirty).toBe(false);
  });

  it("accepts the platform's default Yes/No labels", async () => {
    openBuffer("edited\n", "/ws/a.yaml", true);
    dialog.message.mockResolvedValue("Yes");
    expect(await settleUnsavedFlow()).toBe("resolved");
    expect(fs.files.get("/ws/a.yaml")).toBe("edited\n");

    openBuffer("again\n", "/ws/a.yaml", true);
    dialog.message.mockResolvedValue("No");
    expect(await settleUnsavedFlow()).toBe("resolved");
    expect(fs.files.get("/ws/a.yaml")).toBe("edited\n");
  });

  it("writes nothing on Don't Save", async () => {
    openBuffer("edited\n", "/ws/a.yaml", true);
    dialog.message.mockResolvedValue("Don't Save");
    expect(await settleUnsavedFlow()).toBe("resolved");
    expect(fs.writeTextFile).not.toHaveBeenCalled();
  });

  it("cancels when the dialog is dismissed", async () => {
    openBuffer("edited\n", "/ws/a.yaml", true);
    dialog.message.mockResolvedValue("Cancel");
    expect(await settleUnsavedFlow()).toBe("cancelled");
    expect(fs.writeTextFile).not.toHaveBeenCalled();
  });

  it("asks where to save an untitled buffer, even with autosave on", async () => {
    useSettingsStore.setState({ autoSaveEnabled: true });
    openBuffer("scratch\n", null, true);
    dialog.message.mockResolvedValue("Save");
    dialog.save.mockResolvedValue("/ws/new.yaml");
    expect(await settleUnsavedFlow()).toBe("resolved");
    expect(dialog.message.mock.calls[0][0]).toContain('"Untitled.yaml"');
    expect(fs.files.get("/ws/new.yaml")).toBe("scratch\n");
    expect(useFlowStore.getState()).toMatchObject({ filePath: "/ws/new.yaml", dirty: false });
  });

  it("cancels when the save location picker is dismissed", async () => {
    openBuffer("scratch\n", null, true);
    dialog.message.mockResolvedValue("Save");
    dialog.save.mockResolvedValue(null);
    expect(await settleUnsavedFlow()).toBe("cancelled");
    expect(useFlowStore.getState().dirty).toBe(true);
  });

  it("cancels and reports when the chosen save fails", async () => {
    openBuffer("edited\n", "/ws/a.yaml", true);
    dialog.message.mockResolvedValue("Save");
    fs.writeTextFile.mockRejectedValueOnce(new Error("disk full"));
    expect(await settleUnsavedFlow()).toBe("cancelled");
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      title: "Save failed",
      description: "disk full",
    });
  });
});

describe("openFlowFile", () => {
  it("loads the file and remembers it", async () => {
    expect(await openFlowFile("/ws/b.yaml")).toBe(true);
    expect(useFlowStore.getState()).toMatchObject({
      content: "- back\n",
      filePath: "/ws/b.yaml",
      dirty: false,
    });
    expect(useWorkspaceStore.getState().lastOpenFile).toBe("/ws/b.yaml");
  });

  it("keeps unsaved edits when the user cancels switching files", async () => {
    openBuffer("my edits\n", "/ws/a.yaml", true);
    dialog.message.mockResolvedValue("Cancel");
    expect(await openFlowFile("/ws/b.yaml")).toBe(false);
    expect(useFlowStore.getState()).toMatchObject({
      content: "my edits\n",
      filePath: "/ws/a.yaml",
      dirty: true,
    });
    expect(fs.readTextFile).not.toHaveBeenCalled();
  });

  it("saves the previous file before switching when the user picks Save", async () => {
    openBuffer("my edits\n", "/ws/a.yaml", true);
    dialog.message.mockResolvedValue("Save");
    expect(await openFlowFile("/ws/b.yaml")).toBe(true);
    expect(fs.files.get("/ws/a.yaml")).toBe("my edits\n");
    expect(useFlowStore.getState().content).toBe("- back\n");
  });

  it("re-opening the file being edited keeps the edits", async () => {
    openBuffer("my edits\n", "/ws/a.yaml", true);
    expect(await openFlowFile("/ws/a.yaml")).toBe(true);
    expect(useFlowStore.getState().content).toBe("my edits\n");
    expect(dialog.message).not.toHaveBeenCalled();
    expect(fs.readTextFile).not.toHaveBeenCalled();
  });

  it("toasts when the file can't be read", async () => {
    expect(await openFlowFile("/ws/missing.yaml")).toBe(false);
    expect(useToastStore.getState().toasts.at(-1)?.title).toBe("Open failed");
    expect(useFlowStore.getState().filePath).toBe("/ws/a.yaml");
  });

  it("silent restore forgets a vanished last file without a toast or a prompt", async () => {
    openBuffer("my edits\n", null, true);
    useWorkspaceStore.setState({ lastOpenFile: "/ws/missing.yaml" });
    expect(await openFlowFile("/ws/missing.yaml", { silent: true })).toBe(false);
    expect(useWorkspaceStore.getState().lastOpenFile).toBeNull();
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(dialog.message).not.toHaveBeenCalled();
  });
});

describe("pickWorkspaceFolder", () => {
  it("sets the picked folder as the workspace", async () => {
    dialog.open.mockResolvedValue("/projects/app");
    await pickWorkspaceFolder();
    expect(useWorkspaceStore.getState().folderPath).toBe("/projects/app");
  });

  it("does nothing when the picker is dismissed", async () => {
    useWorkspaceStore.setState({ folderPath: "/old" });
    dialog.open.mockResolvedValue(null);
    await pickWorkspaceFolder();
    expect(useWorkspaceStore.getState().folderPath).toBe("/old");
  });
});
