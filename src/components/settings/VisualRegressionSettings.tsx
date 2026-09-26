// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Button } from "@/components/ui/Button";
import {
  SettingsRow,
  SettingsSection,
  SettingsSubgroup,
  ToggleRow,
  settingsInputClass,
} from "@/components/settings/SettingsPrimitives";
import { cn } from "@/lib/utils";
import {
  useVisualRegressionStore,
  DEFAULT_TOLERANCE,
  DEFAULT_THRESHOLD,
} from "@/stores/visualRegressionStore";

function ThresholdField({
  label,
  hint,
  step,
  value,
  fallback,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  step: string;
  value: number | null;
  fallback: number;
  disabled?: boolean;
  onChange: (v: number | null) => void;
}) {
  const isDefault = value === null;
  return (
    <label className={cn("flex items-center justify-between gap-6", disabled && "opacity-50")}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm">
          {label}
          {isDefault && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              default
            </span>
          )}
        </span>
        <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>
      </span>
      <input
        type="number"
        step={step}
        min="0"
        max="1"
        disabled={disabled}
        value={value ?? fallback}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={cn(settingsInputClass, "w-28 shrink-0 tabular-nums")}
      />
    </label>
  );
}

export function VisualRegressionSettings() {
  const enabled = useVisualRegressionStore((s) => s.enabled);
  const tolerance = useVisualRegressionStore((s) => s.tolerance);
  const threshold = useVisualRegressionStore((s) => s.threshold);
  const ignoreStatusBar = useVisualRegressionStore((s) => s.ignoreStatusBar);
  const setEnabled = useVisualRegressionStore((s) => s.setEnabled);
  const setTolerance = useVisualRegressionStore((s) => s.setTolerance);
  const setThreshold = useVisualRegressionStore((s) => s.setThreshold);
  const setIgnoreStatusBar = useVisualRegressionStore((s) => s.setIgnoreStatusBar);
  const reset = useVisualRegressionStore((s) => s.reset);

  const isCustomized = tolerance !== null || threshold !== null;

  return (
    <SettingsSection
      title="Visual Regression"
      description={
        <>
          Catches unintended UI changes. After a flow passes, every screenshot taken by a{" "}
          <code className="font-mono">takeScreenshot</code> command is compared with its baseline in
          the screenshot bank (one bank per device model). When a screenshot changed too much, a
          review opens where you keep the baseline or accept the new look.
        </>
      }
    >
      <SettingsSubgroup title="Comparison">
        <ToggleRow
          label="Compare screenshots after each run"
          description="When off, flows run normally and nothing is compared."
          checked={enabled}
          onCheckedChange={setEnabled}
        />
        <ToggleRow
          label="Ignore system chrome"
          description="Leaves out the parts of the screen that change on their own — status bar (clock, notch, carrier), home indicator / navigation bar and the scroll indicator — to avoid false alarms."
          checked={ignoreStatusBar}
          onCheckedChange={setIgnoreStatusBar}
        />
      </SettingsSubgroup>

      <SettingsSubgroup
        title="Sensitivity"
        description="Raise these if harmless rendering noise gets flagged; lower them to catch smaller changes."
      >
        <ThresholdField
          label="Per-pixel tolerance"
          hint={`How different one pixel must be to count as changed, from 0 to 1. Higher absorbs more anti-aliasing noise. Default ${DEFAULT_TOLERANCE}.`}
          step="0.01"
          value={tolerance}
          fallback={DEFAULT_TOLERANCE}
          disabled={!enabled}
          onChange={setTolerance}
        />
        <ThresholdField
          label="Changed-pixel threshold"
          hint={`Share of changed pixels above which a screenshot counts as a regression, from 0 to 1. ${DEFAULT_THRESHOLD} ≈ 0.1% of the image. Default ${DEFAULT_THRESHOLD}.`}
          step="0.001"
          value={threshold}
          fallback={DEFAULT_THRESHOLD}
          disabled={!enabled}
          onChange={setThreshold}
        />
        <SettingsRow label="Restore defaults" description="Resets both values above.">
          <Button size="sm" variant="outline" onClick={reset} disabled={!enabled || !isCustomized}>
            Reset
          </Button>
        </SettingsRow>
      </SettingsSubgroup>
    </SettingsSection>
  );
}
