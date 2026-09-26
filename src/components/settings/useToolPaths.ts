// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";

import { ipc, type ToolPathsView } from "@/lib/ipc";

export type ToolKey = "adb" | "maestro" | "iproxy" | "maestro_ios_device";

export interface ToolPathsDraft {
  adb: string;
  maestro: string;
  iproxy: string;
  maestro_ios_device: string;
  appleTeamId: string;
}

const EMPTY: ToolPathsDraft = {
  adb: "",
  maestro: "",
  iproxy: "",
  maestro_ios_device: "",
  appleTeamId: "",
};

function draftFrom(v: ToolPathsView): ToolPathsDraft {
  return {
    adb: v.overrides.adb ?? "",
    maestro: v.overrides.maestro ?? "",
    iproxy: v.overrides.iproxy ?? "",
    maestro_ios_device: v.overrides.maestro_ios_device ?? "",
    appleTeamId: v.overrides.apple_team_id ?? "",
  };
}

export function useToolPaths() {
  const [view, setView] = useState<ToolPathsView | null>(null);
  const [draft, setDraft] = useState<ToolPathsDraft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function reload() {
    try {
      const v = await ipc.getToolPaths();
      setView(v);
      setDraft(draftFrom(v));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const v = await ipc.setToolPaths(
        draft.adb || null,
        draft.maestro || null,
        draft.iproxy || null,
        draft.appleTeamId || null,
        draft.maestro_ios_device || null,
      );
      setView(v);
      setDraft(draftFrom(v));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function browse(key: ToolKey) {
    try {
      const picked = await openFileDialog({
        multiple: false,
        directory: false,
        title: `Select the ${key} binary`,
      });
      if (typeof picked === "string" && picked.length > 0) {
        setDraft((d) => ({ ...d, [key]: picked }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const dirty = view !== null && JSON.stringify(draftFrom(view)) !== JSON.stringify(draft);

  return { view, draft, setDraft, busy, error, setError, saved, dirty, save, browse, reload };
}
