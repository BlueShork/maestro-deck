import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  enterInspectMode: vi.fn(),
  suggestSelectors: vi.fn(),
}));
vi.mock("@/lib/ipc", () => ({ ipc }));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn() }));

import type { HierarchyTree, Selector, UINode } from "@/types";

import { useDeviceStore } from "./deviceStore";
import { useInspectorStore } from "./inspectorStore";
import { useRunStore } from "./runStore";
import { useSettingsStore } from "./settingsStore";
import { toast } from "./toastStore";

function node(text: string): UINode {
  return {
    text,
    resource_id: null,
    content_desc: null,
    class: "android.widget.TextView",
    clickable: true,
    enabled: true,
    focused: false,
    bounds: { left: 0, top: 0, right: 10, bottom: 10 },
    children: [],
  } as unknown as UINode;
}

function tree(label: string): HierarchyTree {
  return { root: node(label) } as unknown as HierarchyTree;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const toastError = vi.spyOn(toast, "error");
const toastLoading = vi.spyOn(toast, "loading");
const toastDismiss = vi.spyOn(toast, "dismiss");

beforeEach(() => {
  vi.useRealTimers();
  ipc.enterInspectMode.mockReset();
  ipc.suggestSelectors.mockReset().mockResolvedValue([]);
  useInspectorStore.getState().disable();
  toastError.mockClear();
  toastLoading.mockClear();
  toastDismiss.mockClear();
  useRunStore.setState({ running: false, starting: false });
  useDeviceStore.setState({ current: null });
  useSettingsStore.setState({ fastHierarchyEnabled: false });
});

afterEach(() => {
  useInspectorStore.getState().disable();
  vi.useRealTimers();
});

describe("enable / disable", () => {
  it("enables with the dumped tree", async () => {
    const t = tree("home");
    ipc.enterInspectMode.mockResolvedValue(t);
    await useInspectorStore.getState().enable();
    expect(useInspectorStore.getState()).toMatchObject({ enabled: true, tree: t, loading: false });
  });

  it("passes the fast-hierarchy preference to the dump", async () => {
    useSettingsStore.setState({ fastHierarchyEnabled: true });
    ipc.enterInspectMode.mockResolvedValue(tree("x"));
    await useInspectorStore.getState().enable();
    expect(ipc.enterInspectMode).toHaveBeenCalledWith(true);
  });

  it("stays disabled and reports when the dump fails", async () => {
    ipc.enterInspectMode.mockRejectedValue(new Error("driver offline"));
    await useInspectorStore.getState().enable();
    expect(useInspectorStore.getState()).toMatchObject({ enabled: false, loading: false });
    expect(toastError).toHaveBeenCalledWith("Inspect mode failed", "driver offline");
  });

  it("dismisses the progress toast whatever the outcome", async () => {
    ipc.enterInspectMode.mockResolvedValue(tree("x"));
    await useInspectorStore.getState().enable();
    ipc.enterInspectMode.mockRejectedValue(new Error("x"));
    useInspectorStore.getState().disable();
    await useInspectorStore.getState().enable();
    expect(toastLoading).toHaveBeenCalledTimes(2);
    expect(toastDismiss.mock.calls.map(([id]) => id)).toEqual(
      toastLoading.mock.results.map((r) => r.value),
    );
  });

  it("warns about the slow first dump on an iOS simulator", async () => {
    useDeviceStore.setState({
      current: { serial: "sim", platform: "ios", physical: false } as never,
    });
    const d = deferred<HierarchyTree>();
    ipc.enterInspectMode.mockReturnValue(d.promise);
    const p = useInspectorStore.getState().enable();
    expect(toastLoading.mock.calls[0][0]).toMatch(/iOS simulator driver/);
    d.resolve(tree("x"));
    await p;
  });

  it("a second enable while the first is dumping does not dump twice", async () => {
    const d = deferred<HierarchyTree>();
    ipc.enterInspectMode.mockReturnValue(d.promise);
    const first = useInspectorStore.getState().enable();
    await useInspectorStore.getState().enable();
    d.resolve(tree("x"));
    await first;
    expect(ipc.enterInspectMode).toHaveBeenCalledTimes(1);
  });

  it("a disable during the first dump wins: the late tree is dropped", async () => {
    const d = deferred<HierarchyTree>();
    ipc.enterInspectMode.mockReturnValue(d.promise);
    const p = useInspectorStore.getState().enable();
    useInspectorStore.getState().disable();
    d.resolve(tree("previous device"));
    await p;
    expect(useInspectorStore.getState()).toMatchObject({
      enabled: false,
      tree: null,
      loading: false,
    });
  });

  it("a failure of a dump abandoned by disable stays silent", async () => {
    const d = deferred<HierarchyTree>();
    ipc.enterInspectMode.mockReturnValue(d.promise);
    const p = useInspectorStore.getState().enable();
    useInspectorStore.getState().disable();
    d.reject(new Error("gone"));
    await p;
    expect(toastError).not.toHaveBeenCalled();
  });

  it("can enable again right after a disable interrupted enabling", async () => {
    const stale = deferred<HierarchyTree>();
    ipc.enterInspectMode.mockReturnValueOnce(stale.promise);
    const p = useInspectorStore.getState().enable();
    useInspectorStore.getState().disable();
    const fresh = tree("new device");
    ipc.enterInspectMode.mockResolvedValueOnce(fresh);
    await useInspectorStore.getState().enable();
    stale.resolve(tree("old device"));
    await p;
    expect(useInspectorStore.getState()).toMatchObject({ enabled: true, tree: fresh });
  });

  it("toggle flips between enabled and disabled", async () => {
    ipc.enterInspectMode.mockResolvedValue(tree("x"));
    await useInspectorStore.getState().toggle();
    expect(useInspectorStore.getState().enabled).toBe(true);
    await useInspectorStore.getState().toggle();
    expect(useInspectorStore.getState()).toMatchObject({ enabled: false, tree: null });
  });
});

describe("refresh", () => {
  beforeEach(async () => {
    ipc.enterInspectMode.mockResolvedValueOnce(tree("first"));
    await useInspectorStore.getState().enable();
  });

  it("replaces the tree and clears selection state that pointed into the old one", async () => {
    const n = node("old");
    useInspectorStore.setState({ hovered: n, selected: n, selectors: [{} as Selector] });
    const next = tree("second");
    ipc.enterInspectMode.mockResolvedValueOnce(next);
    await useInspectorStore.getState().refresh();
    expect(useInspectorStore.getState()).toMatchObject({
      tree: next,
      hovered: null,
      selected: null,
      selectors: [],
      loading: false,
    });
  });

  it("does nothing when inspect mode is off", async () => {
    useInspectorStore.getState().disable();
    ipc.enterInspectMode.mockClear();
    await useInspectorStore.getState().refresh();
    expect(ipc.enterInspectMode).not.toHaveBeenCalled();
  });

  it("does not resurrect a tree after inspect mode was turned off mid-refresh", async () => {
    const d = deferred<HierarchyTree>();
    ipc.enterInspectMode.mockReturnValueOnce(d.promise);
    const p = useInspectorStore.getState().refresh();
    useInspectorStore.getState().disable();
    d.resolve(tree("late"));
    await p;
    expect(useInspectorStore.getState()).toMatchObject({
      enabled: false,
      tree: null,
      loading: false,
    });
  });

  it("keeps the old tree and reports on failure", async () => {
    const before = useInspectorStore.getState().tree;
    ipc.enterInspectMode.mockRejectedValueOnce("timeout");
    await useInspectorStore.getState().refresh();
    expect(useInspectorStore.getState()).toMatchObject({ tree: before, loading: false });
    expect(toastError).toHaveBeenCalledWith("Refresh failed", "timeout");
  });
});

describe("background dumps", () => {
  beforeEach(async () => {
    ipc.enterInspectMode.mockResolvedValueOnce(tree("first"));
    await useInspectorStore.getState().enable();
    ipc.enterInspectMode.mockClear();
    vi.useFakeTimers();
  });

  it("scheduleAutoRefresh collapses a burst of taps into one dump", async () => {
    const next = tree("after taps");
    ipc.enterInspectMode.mockResolvedValue(next);
    const { scheduleAutoRefresh } = useInspectorStore.getState();
    scheduleAutoRefresh();
    await vi.advanceTimersByTimeAsync(100);
    scheduleAutoRefresh();
    await vi.advanceTimersByTimeAsync(100);
    scheduleAutoRefresh();
    await vi.advanceTimersByTimeAsync(300);
    expect(ipc.enterInspectMode).toHaveBeenCalledTimes(1);
    expect(useInspectorStore.getState().tree).toBe(next);
  });

  it("never dumps while a run owns the device", async () => {
    useRunStore.setState({ running: true });
    useInspectorStore.getState().scheduleAutoRefresh();
    await vi.advanceTimersByTimeAsync(1000);
    useRunStore.setState({ running: false, starting: true });
    vi.setSystemTime(Date.now() + 10_000);
    useInspectorStore.getState().refreshIfStale();
    expect(ipc.enterInspectMode).not.toHaveBeenCalled();
  });

  it("refreshIfStale only dumps once the tree is older than the threshold", async () => {
    ipc.enterInspectMode.mockResolvedValue(tree("fresh"));
    useInspectorStore.getState().refreshIfStale();
    expect(ipc.enterInspectMode).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 2500);
    useInspectorStore.getState().refreshIfStale();
    useInspectorStore.getState().refreshIfStale();
    expect(ipc.enterInspectMode).toHaveBeenCalledTimes(1);
  });

  it("a failed background dump is silent and keeps the tree", async () => {
    const before = useInspectorStore.getState().tree;
    ipc.enterInspectMode.mockRejectedValue(new Error("flake"));
    useInspectorStore.getState().scheduleAutoRefresh();
    await vi.advanceTimersByTimeAsync(300);
    expect(useInspectorStore.getState()).toMatchObject({ tree: before, loading: false });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("disable cancels a scheduled dump", async () => {
    useInspectorStore.getState().scheduleAutoRefresh();
    useInspectorStore.getState().disable();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ipc.enterInspectMode).not.toHaveBeenCalled();
  });

  it("a background dump finishing after disable leaves inspect mode off and idle", async () => {
    const d = deferred<HierarchyTree>();
    ipc.enterInspectMode.mockReturnValue(d.promise);
    useInspectorStore.getState().scheduleAutoRefresh();
    await vi.advanceTimersByTimeAsync(300);
    expect(useInspectorStore.getState().loading).toBe(true);
    useInspectorStore.getState().disable();
    d.resolve(tree("late"));
    await vi.advanceTimersByTimeAsync(0);
    expect(useInspectorStore.getState()).toMatchObject({
      enabled: false,
      tree: null,
      loading: false,
    });
  });
});

describe("hover and selection", () => {
  it("setHovered does not notify subscribers when the hovered node is unchanged", () => {
    const n = node("a");
    const listener = vi.fn();
    const unsub = useInspectorStore.subscribe(listener);
    useInspectorStore.getState().setHovered(n);
    useInspectorStore.getState().setHovered(n);
    useInspectorStore.getState().setHovered(null);
    useInspectorStore.getState().setHovered(null);
    unsub();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("select loads selector suggestions for the node", async () => {
    const n = node("Login");
    const sels = [{ kind: "text", value: "Login" }] as unknown as Selector[];
    ipc.suggestSelectors.mockResolvedValue(sels);
    await useInspectorStore.getState().select(n);
    expect(useInspectorStore.getState()).toMatchObject({ selected: n, selectors: sels });
  });

  it("select(null) clears the selection", async () => {
    useInspectorStore.setState({ selected: node("a"), selectors: [{} as Selector] });
    await useInspectorStore.getState().select(null);
    expect(useInspectorStore.getState()).toMatchObject({ selected: null, selectors: [] });
  });

  it("slow suggestions for an earlier node never overwrite the current selection's", async () => {
    const a = node("A");
    const b = node("B");
    const slow = deferred<Selector[]>();
    const forB = [{ kind: "text", value: "B" }] as unknown as Selector[];
    ipc.suggestSelectors.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(forB);
    const pa = useInspectorStore.getState().select(a);
    await useInspectorStore.getState().select(b);
    slow.resolve([{ kind: "text", value: "A" }] as unknown as Selector[]);
    await pa;
    expect(useInspectorStore.getState()).toMatchObject({ selected: b, selectors: forB });
  });

  it("reports a suggestion failure for the current selection only", async () => {
    ipc.suggestSelectors.mockRejectedValueOnce(new Error("bad node"));
    await useInspectorStore.getState().select(node("x"));
    expect(toastError).toHaveBeenCalledWith("Selector suggestion failed", "bad node");

    toastError.mockClear();
    const slow = deferred<Selector[]>();
    ipc.suggestSelectors.mockReturnValueOnce(slow.promise).mockResolvedValueOnce([]);
    const p = useInspectorStore.getState().select(node("old"));
    await useInspectorStore.getState().select(node("new"));
    slow.reject(new Error("stale"));
    await p;
    await flush();
    expect(toastError).not.toHaveBeenCalled();
  });
});
