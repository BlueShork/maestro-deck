// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { SettingsSection } from "@/components/settings/SettingsPrimitives";
import { BILLY_SYSTEM_PROMPT } from "@/lib/chat/systemPrompt";
import { useBillyPromptStore } from "@/stores/billyPromptStore";

export function BillySettings() {
  const customPrompt = useBillyPromptStore((s) => s.customPrompt);
  const setCustomPrompt = useBillyPromptStore((s) => s.setCustomPrompt);
  const reset = useBillyPromptStore((s) => s.reset);

  // Draft starts from the effective prompt: the override if one exists, else
  // the embedded default. Editing only persists on Save.
  const [draft, setDraft] = useState(customPrompt ?? BILLY_SYSTEM_PROMPT);

  const isCustomized = customPrompt !== null;
  const effective = customPrompt ?? BILLY_SYSTEM_PROMPT;
  const dirty = draft !== effective;

  const onSave = () => setCustomPrompt(draft);
  const onReset = () => {
    reset();
    setDraft(BILLY_SYSTEM_PROMPT);
  };

  return (
    <SettingsSection
      title="Billy AI"
      description="Billy is the in-app AI assistant. This is its system prompt — the role and Maestro knowledge it works from. Edit it to tailor Billy to your project; reset to restore the version shipped with the app."
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            System prompt
          </span>
          {isCustomized ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              Customized
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">Default</span>
          )}
        </div>

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          spellCheck={false}
          className="h-80 w-full resize-y rounded border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed"
        />

        <p className="text-[11px] text-muted-foreground">
          Changes take effect on Billy&apos;s next message. Clearing the editor and saving is
          treated as a reset to the default.
        </p>

        <div className="flex gap-2">
          <Button size="sm" onClick={onSave} disabled={!dirty}>
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={onReset} disabled={!isCustomized}>
            Reset to default
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
