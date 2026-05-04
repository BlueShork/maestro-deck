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
});
