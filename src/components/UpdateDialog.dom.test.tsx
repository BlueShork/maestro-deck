import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { useUpdateStore } from "@/stores/updateStore";

import { UpdateDialog } from "./UpdateDialog";

const downloadAndInstall = vi.fn(async () => {});

beforeEach(() => {
  downloadAndInstall.mockClear();
  useUpdateStore.setState({
    phase: "idle",
    available: null,
    downloadPercent: 0,
    error: null,
    downloadAndInstall,
  });
});
afterEach(cleanup);

describe("UpdateDialog", () => {
  it("stays closed while nothing is on offer", () => {
    render(<UpdateDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => useUpdateStore.setState({ phase: "not-available" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("presents the new version with its release notes rendered as markdown", async () => {
    useUpdateStore.setState({
      phase: "available",
      available: { version: "1.3.0", notes: "## Fixes\n- **Faster** stream" },
    });
    render(<UpdateDialog />);
    expect(screen.getByText("v1.3.0")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Fixes" })).toBeTruthy();
    expect(screen.getByText("Faster").tagName).toBe("STRONG");
  });

  it("starts the install from the call to action", () => {
    useUpdateStore.setState({ phase: "available", available: { version: "1.3.0", notes: null } });
    render(<UpdateDialog />);
    fireEvent.click(screen.getByRole("button", { name: /Install update/ }));
    expect(downloadAndInstall).toHaveBeenCalledOnce();
  });

  it("Later closes the offer", () => {
    useUpdateStore.setState({ phase: "available", available: { version: "1.3.0", notes: null } });
    render(<UpdateDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(useUpdateStore.getState().phase).toBe("idle");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows download progress and cannot be dismissed while installing", () => {
    useUpdateStore.setState({
      phase: "downloading",
      available: { version: "1.3.0", notes: null },
      downloadPercent: 42,
    });
    render(<UpdateDialog />);
    expect(screen.getByText("42%")).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(useUpdateStore.getState().phase).toBe("downloading");
    expect(screen.getByRole("dialog")).toBeTruthy();

    act(() => useUpdateStore.setState({ phase: "installing" }));
    expect(screen.getByText("Restarting…")).toBeTruthy();
  });

  it("surfaces an error and resets on close", () => {
    useUpdateStore.setState({ phase: "error", error: "signature mismatch" });
    render(<UpdateDialog />);
    expect(screen.getByText("Update failed")).toBeTruthy();
    expect(screen.getByText("signature mismatch")).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(useUpdateStore.getState().phase).toBe("idle");
  });
});
