// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

export interface FlowSnapshot {
  content: string;
  filePath: string | null;
  dirty: boolean;
}

export interface AutosaveEngineDeps {
  write: (path: string, content: string) => Promise<void>;
  onError: (message: string) => void;
  getFlow: () => FlowSnapshot;
  getEnabled: () => boolean;
  delayMs: number;
}

export interface AutosaveEngine {
  notifyChange: () => void;
  notifyDirtyCleared: (path: string | null) => void;
  notifyPathChanged: (path: string | null) => void;
  dispose: () => void;
}

export function createAutosaveEngine(deps: AutosaveEngineDeps): AutosaveEngine {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  // A fire that landed during a write: the edits it was for still need saving
  // once that write settles, even if no further keystroke comes.
  let missedFire = false;
  let disposed = false;
  const disabled = new Set<string>();

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, deps.delayMs);
  };

  const flush = (): void => {
    timer = null;
    if (inFlight) {
      missedFire = true;
      return;
    }
    if (!deps.getEnabled()) return;
    const { content, filePath, dirty } = deps.getFlow();
    if (!filePath || !dirty) return;
    if (disabled.has(filePath)) return;
    inFlight = true;
    deps
      .write(filePath, content)
      .catch((err: unknown) => {
        disabled.add(filePath);
        deps.onError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        inFlight = false;
        if (missedFire && !disposed) {
          missedFire = false;
          schedule();
        }
      });
  };

  return {
    notifyChange(): void {
      schedule();
    },
    notifyDirtyCleared(path: string | null): void {
      // While inFlight, our own write's saved() call drives dirty→false;
      // ignoring it here ensures only *external* saves clear the disabled flag.
      if (path && !inFlight) disabled.delete(path);
    },
    notifyPathChanged(path: string | null): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      missedFire = false;
      if (path) disabled.delete(path);
    },
    dispose(): void {
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
