// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { AiSettings } from "@/components/AiSettings";
import { SettingsSection, SettingsSubgroup } from "@/components/settings/SettingsPrimitives";
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
      description="Billy is the AI assistant in the chat panel. He can see the connected device, tap around, and write, fix and run flows for you. Choose where his answers come from, and optionally tailor his instructions to your project."
    >
      <AiSettings />

      <SettingsSubgroup
        title="System prompt"
        description="The role and Maestro knowledge Billy works from. Edit it to add your app's conventions; changes apply from Billy's next message. Saving an empty prompt restores the default."
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">Instructions</span>
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
            aria-label="Billy system prompt"
            className="h-80 w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={onSave} disabled={!dirty}>
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={onReset} disabled={!isCustomized}>
              Reset to default
            </Button>
          </div>
        </div>
      </SettingsSubgroup>
    </SettingsSection>
  );
}
