// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { MetricsSparkline } from "@/components/MetricsSparkline";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { metricsForDevice, thermalLabel, type MetricCardId } from "@/lib/metricsCards";
import { useDeviceStore } from "@/stores/deviceStore";
import { useMetricsStore } from "@/stores/metricsStore";
import { usePanelsStore } from "@/stores/panelsStore";

export function MetricsPanel() {
  const hidePanel = usePanelsStore((s) => s.hide);
  const pkg = useMetricsStore((s) => s.currentPackage);
  const samples = useMetricsStore((s) => s.samples);
  const stopped = useMetricsStore((s) => s.stoppedReason);
  const device = useDeviceStore((s) => s.current);

  const last = samples[samples.length - 1];
  const layout = device ? metricsForDevice(device.platform, device.physical) : null;

  return (
    <section className="flex h-full min-h-0 w-full flex-col border-l border-border bg-muted/30">
      <header className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Performance
          </div>
          <div className="truncate text-[11px] text-foreground/80">{pkg ?? "—"}</div>
        </div>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => hidePanel("metrics")}
          aria-label="Close performance panel"
        >
          <X className="h-3 w-3" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[11px]">
        {!device || !layout ? (
          <div className="text-muted-foreground">Connect a device to monitor performance.</div>
        ) : layout.kind === "limited" ? (
          <div className="text-muted-foreground">{layout.message}</div>
        ) : stopped && stopped !== "unsupported" ? (
          <div className="text-red-600 dark:text-red-400">Monitoring stopped ({stopped}).</div>
        ) : samples.length === 0 ? (
          <div className="text-muted-foreground">Waiting for samples…</div>
        ) : (
          <TooltipProvider delayDuration={300}>
            <div className="space-y-3">
              {layout.cards.map((id) => (
                <MetricCard key={id} id={id} samples={samples} last={last} />
              ))}
              {layout.note ? (
                <div className="pt-1 text-[10px] text-muted-foreground">{layout.note}</div>
              ) : null}
            </div>
          </TooltipProvider>
        )}
      </div>
    </section>
  );
}

function MetricCard({
  id,
  samples,
  last,
}: {
  id: MetricCardId;
  samples: import("@/stores/metricsStore").Sample[];
  last: import("@/stores/metricsStore").Sample | undefined;
}) {
  switch (id) {
    case "cpu":
      return (
        <Card
          label="CPU"
          value={last?.cpuPct.toFixed(1) ?? "—"}
          unit="%"
          series={samples.map((s) => s.cpuPct)}
          tooltip="CPU time consumed by the app process. 100% = one core saturated."
        />
      );
    case "ram":
      return (
        <Card
          label="RAM"
          value={last?.memMb.toFixed(0) ?? "—"}
          unit="MB"
          series={samples.map((s) => s.memMb)}
          tooltip="Resident memory (RSS) used by the app process."
        />
      );
    case "fps":
      return (
        <Card
          label="FPS"
          value={last?.fps != null ? last.fps.toFixed(0) : "—"}
          unit=""
          series={samples.map((s) => s.fps)}
          tooltip="Frames per second over the last 5s. Idle apps stay near 0. From dumpsys gfxinfo."
        />
      );
    case "jank":
      return (
        <Card
          label="Jank"
          value={last?.jankPct != null ? last.jankPct.toFixed(1) : "—"}
          unit="%"
          series={samples.map((s) => s.jankPct)}
          tooltip="Percent of frames missing the 16.67ms deadline. <5% feels smooth."
        />
      );
    case "frameTimes":
      return (
        <Card
          label="Frame time (p95)"
          value={last?.frameP95 != null ? last.frameP95.toFixed(0) : "—"}
          unit="ms"
          series={samples.map((s) => s.frameP95)}
          tooltip={`Per-frame render time percentiles (ms). Latest — p50: ${fmt(last?.frameP50)}, p90: ${fmt(last?.frameP90)}, p95: ${fmt(last?.frameP95)}, p99: ${fmt(last?.frameP99)}. Lower is smoother; watch p95/p99 for hitches.`}
        />
      );
    case "thermal":
      return (
        <Card
          label="Thermal"
          value={thermalLabel(last?.thermalStatus ?? null)}
          unit=""
          tooltip="Device thermal throttling state (dumpsys thermalservice). Anything above 'None' will depress CPU/GPU and skew other metrics."
        />
      );
  }
}

function fmt(v: number | null | undefined): string {
  return v != null ? v.toFixed(0) : "—";
}

function Card({
  label,
  value,
  unit,
  series,
  tooltip,
}: {
  label: string;
  value: string;
  unit: string;
  series?: (number | null)[];
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="cursor-help">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
            <span className="font-mono tabular-nums">
              {value} <span className="text-[10px] text-muted-foreground">{unit}</span>
            </span>
          </div>
          {series ? <MetricsSparkline values={series} className="text-foreground/60" /> : null}
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[260px] text-[11px] leading-snug">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
