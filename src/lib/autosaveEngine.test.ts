import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAutosaveEngine, type AutosaveEngineDeps } from "./autosaveEngine";

function makeDeps(overrides: Partial<AutosaveEngineDeps> = {}): {
  deps: AutosaveEngineDeps;
  write: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
} {
  const write = vi.fn(async (_path: string, _content: string) => {});
  const onError = vi.fn((_message: string) => {});
  const deps: AutosaveEngineDeps = {
    write,
    onError,
    getFlow: () => ({ content: "a: 1", filePath: "/tmp/flow.yaml", dirty: true }),
    getEnabled: () => true,
    delayMs: 1000,
    ...overrides,
  };
  return { deps, write, onError };
}

describe("autosaveEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("coalesces rapid notifyChange calls into a single write", async () => {
    const { deps, write } = makeDeps();
    const engine = createAutosaveEngine(deps);
    engine.notifyChange();
    vi.advanceTimersByTime(200);
    engine.notifyChange();
    vi.advanceTimersByTime(200);
    engine.notifyChange();
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("/tmp/flow.yaml", "a: 1");
  });

  it("does not write when filePath is null", async () => {
    const { deps, write } = makeDeps({
      getFlow: () => ({ content: "a", filePath: null, dirty: true }),
    });
    const engine = createAutosaveEngine(deps);
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
  });

  it("does not write when dirty is false", async () => {
    const { deps, write } = makeDeps({
      getFlow: () => ({ content: "a", filePath: "/tmp/flow.yaml", dirty: false }),
    });
    const engine = createAutosaveEngine(deps);
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
  });

  it("does not write when getEnabled() returns false", async () => {
    const { deps, write } = makeDeps({ getEnabled: () => false });
    const engine = createAutosaveEngine(deps);
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
  });

  it("skips a fire while a previous write is in flight", async () => {
    let resolveFirst: (() => void) | null = null;
    const write = vi.fn(
      (_path: string, _content: string) =>
        new Promise<void>((resolve) => {
          if (resolveFirst === null) {
            resolveFirst = resolve;
          } else {
            resolve();
          }
        }),
    );
    const { deps } = makeDeps({ write });
    const engine = createAutosaveEngine(deps);

    // First save is now in-flight, never resolves.
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);

    // Second debounce while first is still pending — must skip.
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);

    // Resolve the first; a subsequent edit must save again.
    // (Local copy avoids TS narrowing the captured let-binding to never.)
    const resolver = resolveFirst as (() => void) | null;
    resolver?.();
    await Promise.resolve();
    await Promise.resolve();
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("disables autosave for a path after a write error and re-enables on external dirty-clear", async () => {
    const flow: { content: string; filePath: string | null; dirty: boolean } = {
      content: "a",
      filePath: "/tmp/flow.yaml",
      dirty: true,
    };
    const write = vi
      .fn<(path: string, content: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("EACCES"))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const engine = createAutosaveEngine({
      write,
      onError,
      getFlow: () => flow,
      getEnabled: () => true,
      delayMs: 1000,
    });

    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("EACCES");

    flow.content = "b";
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);

    flow.dirty = false;
    engine.notifyDirtyCleared(flow.filePath);
    flow.dirty = true;
    flow.content = "c";
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith("/tmp/flow.yaml", "c");
  });

  it("notifyPathChanged cancels pending timer and clears disabled flag for the new path", async () => {
    const flow: { content: string; filePath: string | null; dirty: boolean } = {
      content: "a",
      filePath: "/tmp/old.yaml",
      dirty: true,
    };
    const write = vi
      .fn<(path: string, content: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("EACCES"))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const engine = createAutosaveEngine({
      write,
      onError,
      getFlow: () => flow,
      getEnabled: () => true,
      delayMs: 1000,
    });

    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);

    // Switch to a new file. Pending timer (none here) cancelled, disabled cleared.
    flow.filePath = "/tmp/new.yaml";
    engine.notifyPathChanged(flow.filePath);

    flow.content = "z";
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith("/tmp/new.yaml", "z");
  });

  it("dispose prevents a pending timer from firing", async () => {
    const { deps, write } = makeDeps();
    const engine = createAutosaveEngine(deps);
    engine.notifyChange();
    engine.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(write).not.toHaveBeenCalled();
  });
});
