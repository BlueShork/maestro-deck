// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useToastStore, toast } from "./toastStore";

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("toastStore.push", () => {
  it("adds the first toast immediately as open", () => {
    const id = useToastStore.getState().push({ title: "Hi", variant: "default" });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].id).toBe(id);
    expect(toasts[0].open).toBe(true);
    expect(toasts[0].title).toBe("Hi");
  });

  it("returns a unique id per call", () => {
    const a = useToastStore.getState().push({ title: "a", variant: "default" });
    useToastStore.getState().setClosed(a);
    const b = useToastStore.getState().push({ title: "b", variant: "default" });
    expect(a).not.toBe(b);
  });

  it("starts exit animation on existing open toast then drops the new one in", () => {
    useToastStore.getState().push({ title: "old", variant: "default" });
    expect(useToastStore.getState().toasts[0].open).toBe(true);

    useToastStore.getState().push({ title: "new", variant: "success" });
    // Immediately after second push, old toast should be marked closing.
    const mid = useToastStore.getState().toasts;
    expect(mid).toHaveLength(1);
    expect(mid[0].open).toBe(false);
    expect(mid[0].title).toBe("old");

    vi.advanceTimersByTime(180);

    const after = useToastStore.getState().toasts;
    expect(after).toHaveLength(1);
    expect(after[0].title).toBe("new");
    expect(after[0].open).toBe(true);
  });
});

describe("toastStore.dismiss / setClosed", () => {
  it("dismiss flips open=false but keeps the toast", () => {
    const id = useToastStore.getState().push({ title: "x", variant: "default" });
    useToastStore.getState().dismiss(id);
    const t = useToastStore.getState().toasts;
    expect(t).toHaveLength(1);
    expect(t[0].open).toBe(false);
  });

  it("setClosed removes the toast", () => {
    const id = useToastStore.getState().push({ title: "x", variant: "default" });
    useToastStore.getState().setClosed(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("dismiss/setClosed on unknown id is a no-op", () => {
    useToastStore.getState().push({ title: "x", variant: "default" });
    useToastStore.getState().dismiss("nope");
    useToastStore.getState().setClosed("nope");
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});

describe("toast helpers", () => {
  it("info/success/error/action map to the right variant", () => {
    toast.info("a");
    expect(useToastStore.getState().toasts[0].variant).toBe("default");
    useToastStore.setState({ toasts: [] });

    toast.success("b");
    expect(useToastStore.getState().toasts[0].variant).toBe("success");
    useToastStore.setState({ toasts: [] });

    toast.error("c");
    expect(useToastStore.getState().toasts[0].variant).toBe("error");
    useToastStore.setState({ toasts: [] });

    toast.action("d");
    expect(useToastStore.getState().toasts[0].variant).toBe("action");
  });

  it("loading is persistent and returns an id usable with dismiss", () => {
    const id = toast.loading("working");
    const t = useToastStore.getState().toasts[0];
    expect(t.persistent).toBe(true);
    expect(t.variant).toBe("action");
    toast.dismiss(id);
    expect(useToastStore.getState().toasts[0].open).toBe(false);
  });
});
