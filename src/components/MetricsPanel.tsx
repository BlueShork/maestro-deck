// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { MetricsSparkline } from "@/components/MetricsSparkline";
import { metricsForDevice, thermalLabel, type MetricCardId } from "@/lib/metricsCards";
import { useDeviceStore } from "@/stores/deviceStore";
import { useMetricsStore } from "@/stores/metricsStore";

export function MetricsBody() {
  const pkg = useMetricsStore((s) => s.currentPackage);
  const samples = useMetricsStore((s) => s.samples);
  const stopped = useMetricsStore((s) => s.stoppedReason);
  const device = useDeviceStore((s) => s.current);

  const last = samples[samples.length - 1];
  const layout = device ? metricsForDevice(device.platform, device.physical) : null;

  return (
    <div className="text-[11px]">
      <div className="mono-label mb-2 truncate">{pkg ?? "—"}</div>
      {!device || !layout ? (
        <div className="text-muted-foreground">Connect a device to monitor performance.</div>
      ) : layout.kind === "limited" ? (
        <div className="text-muted-foreground">{layout.message}</div>
      ) : stopped && stopped !== "unsupported" ? (
        <div className="text-destructive">Monitoring stopped ({stopped}).</div>
      ) : samples.length === 0 ? (
        <div className="text-muted-foreground">Waiting for samples…</div>
      ) : (
        <TooltipProvider delayDuration={300}>
          {/* Landing tiles: cells sharing hairlines, the figure in Inter Tight. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] border-l border-t border-border">
            {layout.cards.map((id) => (
              <MetricCard key={id} id={id} samples={samples} last={last} />
            ))}
          </div>
          {layout.note ? (
            <div className="pt-2 text-[10px] text-muted-foreground">{layout.note}</div>
          ) : null}
        </TooltipProvider>
      )}
    </div>
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
        <div className="flex cursor-help flex-col gap-2 border-b border-r border-border p-3 transition-colors hover:bg-accent">
          <span className="mono-label text-[10px]">{label}</span>
          <span className="font-display text-2xl font-medium leading-none tracking-[-0.03em] tabular-nums">
            {value}
            {unit ? (
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">{unit}</span>
            ) : null}
          </span>
          {series ? <MetricsSparkline values={series} className="text-brand" /> : null}
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[260px] text-[11px] leading-snug">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
