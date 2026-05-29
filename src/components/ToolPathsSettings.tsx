// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Folder } from "lucide-react";
import { useEffect, useState } from "react";

import { ipc, type ToolPathsView } from "@/lib/ipc";

const TOOLS = [
  {
    key: "adb" as const,
    label: "ADB",
    placeholder: "/opt/homebrew/bin/adb",
    hint: "Android Debug Bridge — usually installed by Android Studio or Homebrew.",
  },
  {
    key: "maestro" as const,
    label: "Maestro CLI",
    placeholder: "~/.maestro/bin/maestro",
    hint: "Test runner — installed via the official curl script or Homebrew.",
  },
  {
    key: "iproxy" as const,
    label: "iproxy (iOS)",
    placeholder: "/opt/homebrew/bin/iproxy",
    hint: "USB port-forwarder for physical iPhones — from libusbmuxd (`brew install libusbmuxd`).",
  },
];

export function ToolPathsSettings() {
  const [view, setView] = useState<ToolPathsView | null>(null);
  const [draft, setDraft] = useState<{
    adb: string;
    maestro: string;
    iproxy: string;
    appleTeamId: string;
  }>({ adb: "", maestro: "", iproxy: "", appleTeamId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const v = await ipc.getToolPaths();
      setView(v);
      setDraft({
        adb: v.overrides.adb ?? "",
        maestro: v.overrides.maestro ?? "",
        iproxy: v.overrides.iproxy ?? "",
        appleTeamId: v.overrides.apple_team_id ?? "",
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const v = await ipc.setToolPaths(
        draft.adb || null,
        draft.maestro || null,
        draft.iproxy || null,
        draft.appleTeamId || null,
      );
      setView(v);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleBrowse(key: "adb" | "maestro" | "iproxy") {
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

  const dirty =
    view !== null &&
    ((view.overrides.adb ?? "") !== draft.adb ||
      (view.overrides.maestro ?? "") !== draft.maestro ||
      (view.overrides.iproxy ?? "") !== draft.iproxy ||
      (view.overrides.apple_team_id ?? "") !== draft.appleTeamId);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="text-xs font-medium text-muted-foreground">Tool paths</span>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Override here if the app can&apos;t find <code className="font-mono">adb</code> or{" "}
          <code className="font-mono">maestro</code> automatically (typical on locked-down work
          machines where the GUI doesn&apos;t inherit your shell PATH). Leave empty to use the
          default resolution.
        </p>
      </div>

      {TOOLS.map((tool) => {
        const resolved = view ? view[`resolved_${tool.key}` as const] : "";
        const overridden = (view?.overrides[tool.key] ?? "") !== "";
        return (
          <div key={tool.key} className="flex flex-col gap-1">
            <label className="text-xs font-medium" htmlFor={`tool-${tool.key}`}>
              {tool.label}
            </label>
            <div className="flex gap-1.5">
              <input
                id={`tool-${tool.key}`}
                type="text"
                value={draft[tool.key]}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraft((d) => ({ ...d, [tool.key]: value }));
                }}
                placeholder={tool.placeholder}
                spellCheck={false}
                className="flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => handleBrowse(tool.key)}
                className="inline-flex items-center gap-1 rounded border border-border bg-muted/30 px-2 py-1 text-xs hover:bg-muted"
                title="Browse for the binary"
              >
                <Folder className="h-3 w-3" />
                Browse
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {tool.hint}
              <br />
              <span className="font-mono">
                Currently using: {resolved || "(unresolved)"}
                {!overridden && resolved !== tool.key && " (auto-detected)"}
              </span>
            </p>
          </div>
        );
      })}

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" htmlFor="tool-apple-team-id">
          Apple Team ID (iOS)
        </label>
        <input
          id="tool-apple-team-id"
          type="text"
          value={draft.appleTeamId}
          onChange={(e) => {
            const value = e.target.value;
            setDraft((d) => ({ ...d, appleTeamId: value }));
          }}
          placeholder="ABCDE12345"
          spellCheck={false}
          className="rounded border border-border bg-background px-2 py-1 font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Used to code-sign the iOS test driver when launching it via{" "}
          <code className="font-mono">maestro studio</code>. Found in your Apple Developer account
          (Membership → Team ID). Leave empty if maestro is already configured with it.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          Changes take effect on the next ADB / Maestro call — no restart needed.
        </span>
        <div className="flex items-center gap-2">
          {saved && <span className="text-[11px] text-green-600">Saved.</span>}
          {error && <span className="text-[11px] text-destructive">{error}</span>}
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={handleSave}
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
