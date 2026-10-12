import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast, useToastStore } from "@/stores/toastStore";

import { Toaster } from "./Toast";

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ toasts: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const settle = (ms = 400) => act(() => void vi.advanceTimersByTime(ms));

describe("Toaster", () => {
  it("shows an error with its description as an alert, dismissible by hand", () => {
    render(<Toaster />);
    act(() => void toast.error("Run failed", "maestro not found"));
    expect(screen.getByRole("alert").textContent).toContain("maestro not found");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    settle();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("compact toasts keep only the title", () => {
    render(<Toaster />);
    act(() => void toast.success("Saved", "/very/long/path.yaml"));
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.queryByText("/very/long/path.yaml")).toBeNull();
  });

  it("a timed toast closes when its bar runs out", () => {
    const { container } = render(<Toaster />);
    act(() => void toast.info("Device disconnected"));
    fireEvent.animationEnd(container.querySelector(".toast-bar")!);
    settle();
    expect(screen.queryByText("Device disconnected")).toBeNull();
  });

  it("a persistent toast has no bar and stays until dismissed by its owner", () => {
    const { container } = render(<Toaster />);
    let id = "";
    act(() => {
      id = toast.loading("Dumping hierarchy…");
    });
    expect(container.querySelector(".toast-bar")).toBeNull();
    settle(60_000);
    expect(screen.getByText("Dumping hierarchy…")).toBeTruthy();
    act(() => toast.dismiss(id));
    settle();
    expect(screen.queryByText("Dumping hierarchy…")).toBeNull();
  });

  it("a newer toast replaces the one on screen", () => {
    render(<Toaster />);
    act(() => void toast.info("First"));
    act(() => void toast.info("Second"));
    settle();
    expect(screen.queryByText("First")).toBeNull();
    expect(screen.getByText("Second")).toBeTruthy();
  });

  it("a loading toast dismissed before it even appeared never shows up", () => {
    render(<Toaster />);
    act(() => void toast.info("On screen"));
    let id = "";
    act(() => {
      id = toast.loading("Quick op");
    });
    act(() => toast.dismiss(id));
    settle();
    expect(screen.queryByText("Quick op")).toBeNull();
  });

  it("runs the inline action and closes", () => {
    const onClick = vi.fn();
    render(<Toaster />);
    act(() => void toast.success("ACME-123 created", undefined, { label: "Open", onClick }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onClick).toHaveBeenCalledOnce();
    settle();
    expect(screen.queryByText("ACME-123 created")).toBeNull();
  });

  it("Escape closes the focused toast", () => {
    render(<Toaster />);
    act(() => void toast.error("Boom"));
    fireEvent.keyDown(screen.getByRole("alert"), { key: "Escape" });
    settle();
    expect(screen.queryByText("Boom")).toBeNull();
  });
});
