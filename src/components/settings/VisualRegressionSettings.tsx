// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Button } from "@/components/ui/Button";
import { SettingsSection } from "@/components/settings/SettingsPrimitives";
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
  onChange,
}: {
  label: string;
  hint: string;
  step: string;
  value: number | null;
  fallback: number;
  onChange: (v: number | null) => void;
}) {
  const isDefault = value === null;
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-sm font-medium">
        {label}
        {isDefault && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
            default
          </span>
        )}
      </span>
      <input
        type="number"
        step={step}
        min="0"
        max="1"
        value={value ?? fallback}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-36 rounded border border-border bg-transparent px-2 py-1 text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring"
      />
      <span className="text-xs text-muted-foreground">{hint}</span>
    </label>
  );
}

export function VisualRegressionSettings() {
  const tolerance = useVisualRegressionStore((s) => s.tolerance);
  const threshold = useVisualRegressionStore((s) => s.threshold);
  const setTolerance = useVisualRegressionStore((s) => s.setTolerance);
  const setThreshold = useVisualRegressionStore((s) => s.setThreshold);
  const reset = useVisualRegressionStore((s) => s.reset);

  const isCustomized = tolerance !== null || threshold !== null;

  return (
    <SettingsSection
      title="Visual Regression"
      description="Thresholds for comparing run screenshots against the per-device bank. After a successful flow run, captures from takeScreenshot commands are diffed against their baseline; significant changes open a review where you keep the bank or replace it."
    >
      <div className="flex flex-col gap-5">
        <ThresholdField
          label="Per-pixel tolerance"
          hint={`How different a single pixel must be to count as changed (pixelmatch scale, 0–1). Higher absorbs more anti-aliasing noise. Default ${DEFAULT_TOLERANCE}.`}
          step="0.01"
          value={tolerance}
          fallback={DEFAULT_TOLERANCE}
          onChange={setTolerance}
        />
        <ThresholdField
          label="Changed-pixel threshold"
          hint={`Share of changed pixels above which a screenshot is flagged as a regression (0–1). ${DEFAULT_THRESHOLD} ≈ 0.1% of the image. Default ${DEFAULT_THRESHOLD}.`}
          step="0.001"
          value={threshold}
          fallback={DEFAULT_THRESHOLD}
          onChange={setThreshold}
        />
        <div>
          <Button size="sm" variant="outline" onClick={reset} disabled={!isCustomized}>
            Reset to defaults
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
