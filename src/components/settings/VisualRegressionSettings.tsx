// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Button } from "@/components/ui/Button";
import { SettingsSection } from "@/components/settings/SettingsPrimitives";
import {
  useVisualRegressionStore,
  DEFAULT_TOLERANCE,
  DEFAULT_THRESHOLD,
} from "@/stores/visualRegressionStore";

export function VisualRegressionSettings() {
  const tolerance = useVisualRegressionStore((s) => s.tolerance);
  const threshold = useVisualRegressionStore((s) => s.threshold);
  const setTolerance = useVisualRegressionStore((s) => s.setTolerance);
  const setThreshold = useVisualRegressionStore((s) => s.setThreshold);
  const reset = useVisualRegressionStore((s) => s.reset);

  const isCustomized = tolerance !== null || threshold !== null;

  return (
    <SettingsSection
      title="Régression visuelle"
      description="Seuils de comparaison des screenshots de la banque. La tolérance contrôle la sensibilité par pixel (échelle pixelmatch). Le seuil est la part de pixels modifiés au-delà de laquelle un screenshot est signalé."
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span>Tolérance par pixel (défaut {DEFAULT_TOLERANCE})</span>
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={tolerance ?? DEFAULT_TOLERANCE}
            onChange={(e) => setTolerance(e.target.value === "" ? null : Number(e.target.value))}
            className="w-32 rounded border border-border bg-transparent px-2 py-1 dark:border-neutral-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Seuil de pixels changés (défaut {DEFAULT_THRESHOLD})</span>
          <input
            type="number"
            step="0.001"
            min="0"
            max="1"
            value={threshold ?? DEFAULT_THRESHOLD}
            onChange={(e) => setThreshold(e.target.value === "" ? null : Number(e.target.value))}
            className="w-32 rounded border border-border bg-transparent px-2 py-1 dark:border-neutral-700"
          />
        </label>
        <div>
          <Button size="sm" variant="outline" onClick={reset} disabled={!isCustomized}>
            Réinitialiser
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
