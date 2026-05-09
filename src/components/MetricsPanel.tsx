import { X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { MetricsSparkline } from "@/components/MetricsSparkline";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { useDeviceStore } from "@/stores/deviceStore";
import { useMetricsStore } from "@/stores/metricsStore";

export function MetricsPanel() {
  const setPanelOpen = useMetricsStore((s) => s.setPanelOpen);
  const pkg = useMetricsStore((s) => s.currentPackage);
  const samples = useMetricsStore((s) => s.samples);
  const stopped = useMetricsStore((s) => s.stoppedReason);
  const device = useDeviceStore((s) => s.current);

  const last = samples[samples.length - 1];

  return (
    <section className="flex w-[280px] shrink-0 flex-col border-l border-border bg-muted/30">
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
          onClick={() => setPanelOpen(false)}
          aria-label="Close performance panel"
        >
          <X className="h-3 w-3" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[11px]">
        {!device ? (
          <div className="text-muted-foreground">Connect a device to monitor performance.</div>
        ) : stopped ? (
          <div className="text-red-600 dark:text-red-400">Monitoring stopped ({stopped}).</div>
        ) : samples.length === 0 ? (
          <div className="text-muted-foreground">Waiting for samples…</div>
        ) : (
          <TooltipProvider delayDuration={300}>
            <div className="space-y-3">
              <Card
                label="CPU"
                value={last?.cpuPct.toFixed(1) ?? "—"}
                unit="%"
                series={samples.map((s) => s.cpuPct)}
                tooltip="CPU time consumed by the app process. 100% means one core is fully saturated; values above 100% mean multiple cores are in use. Read from /proc/<pid>/stat on the device."
              />
              <Card
                label="RAM"
                value={last?.memMb.toFixed(0) ?? "—"}
                unit="MB"
                series={samples.map((s) => s.memMb)}
                tooltip="Resident memory (VmRSS) used by the app process on the device. Includes shared system libraries, so it slightly overstates the app's exclusive memory usage."
              />
              <Card
                label="FPS"
                value={last?.fps != null ? last.fps.toFixed(0) : "—"}
                unit=""
                series={samples.map((s) => s.fps)}
                tooltip="Frames per second rendered by the app's UI, averaged over the last 5 seconds. An idle app stays near 0 (nothing to redraw). Read from `dumpsys gfxinfo`."
              />
              <Card
                label="Jank"
                value={last?.jankPct != null ? last.jankPct.toFixed(1) : "—"}
                unit="%"
                series={samples.map((s) => s.jankPct)}
                tooltip="Percentage of frames that missed the 16.67 ms deadline (60 FPS target). Under 5% feels smooth; over 10% is visible lag. This is the best indicator of perceived smoothness."
              />
            </div>
          </TooltipProvider>
        )}
      </div>
    </section>
  );
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
  series: (number | null)[];
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
          <MetricsSparkline values={series} className="text-foreground/60" />
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[260px] text-[11px] leading-snug">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
