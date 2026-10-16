import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  quitHandler: null as null | (() => unknown),
  confirmQuit: vi.fn(async () => {}),
  settle: vi.fn(async () => "clean" as "clean" | "resolved" | "cancelled"),
}));

vi.mock("@/lib/ipc", () => ({
  events: {
    onQuitRequested: async (fn: () => unknown) => {
      h.quitHandler = fn;
      return () => {
        h.quitHandler = null;
      };
    },
  },
  ipc: { confirmQuit: h.confirmQuit },
}));
vi.mock("@/lib/flow-io", () => ({ settleUnsavedFlow: h.settle }));

import { useSettingsStore } from "@/stores/settingsStore";

import { QuitConfirmDialog } from "./QuitConfirmDialog";

async function requestQuit() {
  await act(async () => {
    await h.quitHandler?.();
  });
}

async function mount() {
  render(<QuitConfirmDialog />);
  await act(async () => {});
  expect(h.quitHandler).not.toBeNull();
}

describe("QuitConfirmDialog", () => {
  beforeEach(() => {
    h.confirmQuit.mockClear();
    h.settle.mockReset().mockResolvedValue("clean");
    useSettingsStore.setState({ confirmBeforeQuit: true });
  });
  afterEach(() => cleanup());

  it("asks before quitting and quits on confirm", async () => {
    await mount();
    await requestQuit();
    expect(screen.getByText("Quit Maestro Deck?")).toBeTruthy();
    expect(h.confirmQuit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));
    expect(h.confirmQuit).toHaveBeenCalledOnce();
  });

  it("cancel keeps the app open", async () => {
    await mount();
    await requestQuit();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.confirmQuit).not.toHaveBeenCalled();
    expect(screen.queryByText("Quit Maestro Deck?")).toBeNull();
  });

  it("quits straight away when the prompt is turned off", async () => {
    useSettingsStore.setState({ confirmBeforeQuit: false });
    await mount();
    await requestQuit();
    expect(h.confirmQuit).toHaveBeenCalledOnce();
    expect(screen.queryByText("Quit Maestro Deck?")).toBeNull();
  });

  it("'Don't ask me again' turns the prompt off only when quitting", async () => {
    await mount();
    await requestQuit();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useSettingsStore.getState().confirmBeforeQuit).toBe(true);

    await requestQuit();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));
    expect(useSettingsStore.getState().confirmBeforeQuit).toBe(false);
  });

  it("does not quit when the user cancels the unsaved-changes prompt", async () => {
    useSettingsStore.setState({ confirmBeforeQuit: false });
    h.settle.mockResolvedValue("cancelled");
    await mount();
    await requestQuit();
    expect(h.confirmQuit).not.toHaveBeenCalled();
    expect(screen.queryByText("Quit Maestro Deck?")).toBeNull();
  });

  it("quits without a second prompt once unsaved changes were answered", async () => {
    h.settle.mockResolvedValue("resolved");
    await mount();
    await requestQuit();
    expect(h.confirmQuit).toHaveBeenCalledOnce();
    expect(screen.queryByText("Quit Maestro Deck?")).toBeNull();
  });

  it("ignores repeated quit requests while one is being handled", async () => {
    useSettingsStore.setState({ confirmBeforeQuit: false });
    let release!: (v: "clean") => void;
    h.settle.mockImplementation(() => new Promise((r) => (release = r)));
    await mount();
    let first!: Promise<unknown>;
    await act(async () => {
      first = Promise.resolve(h.quitHandler?.());
      await h.quitHandler?.();
    });
    expect(h.settle).toHaveBeenCalledOnce();
    await act(async () => {
      release("clean");
      await first;
    });
    expect(h.confirmQuit).toHaveBeenCalledOnce();
    await requestQuit();
    expect(h.confirmQuit).toHaveBeenCalledOnce();
  });
});
