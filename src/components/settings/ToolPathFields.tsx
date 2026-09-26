// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Folder } from "lucide-react";
import type { ReactNode } from "react";

import { SettingsField, settingsInputClass } from "@/components/settings/SettingsPrimitives";
import type { ToolKey, useToolPaths } from "@/components/settings/useToolPaths";
import { Button } from "@/components/ui/Button";

type ToolPaths = ReturnType<typeof useToolPaths>;

/** One binary path override, with Browse and the path currently in use. */
export function ToolPathField({
  paths,
  tool,
  label,
  placeholder,
  hint,
  extra,
}: {
  paths: ToolPaths;
  tool: ToolKey;
  label: string;
  placeholder: string;
  hint: ReactNode;
  extra?: ReactNode;
}) {
  const { view, draft, setDraft, browse } = paths;
  const resolved = view ? view[`resolved_${tool}` as const] : "";
  const overridden = (view?.overrides[tool] ?? "") !== "";
  const id = `tool-${tool}`;

  return (
    <SettingsField
      label={label}
      htmlFor={id}
      description={
        <>
          {hint}
          <div className="mt-1 truncate font-mono text-[11px]">
            In use: {resolved || "not found"}
            {resolved && !overridden && resolved !== tool ? " (auto-detected)" : ""}
          </div>
          {extra}
        </>
      }
    >
      <div className="flex gap-1.5">
        <input
          id={id}
          type="text"
          value={draft[tool]}
          onChange={(e) => {
            const value = e.target.value;
            setDraft((d) => ({ ...d, [tool]: value }));
          }}
          placeholder={placeholder}
          spellCheck={false}
          className={settingsInputClass}
        />
        <Button size="sm" variant="outline" onClick={() => void browse(tool)}>
          <Folder className="h-3 w-3" />
          Browse
        </Button>
      </div>
    </SettingsField>
  );
}

/** Save row for tool path edits; they apply on the next adb / Maestro call. */
export function ToolPathsSaveBar({ paths }: { paths: ToolPaths }) {
  const { busy, dirty, saved, error, save } = paths;
  return (
    <div className="flex items-center justify-between gap-3 bg-muted/20">
      <span className="text-xs text-muted-foreground">
        Applies on the next adb / Maestro call — no restart needed.
      </span>
      <div className="flex items-center gap-2">
        {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
        <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
