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
  const disabled = new Set<string>();

  const flush = (): void => {
    timer = null;
    if (inFlight) return;
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
      });
  };

  return {
    notifyChange(): void {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, deps.delayMs);
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
      if (path) disabled.delete(path);
    },
    dispose(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
