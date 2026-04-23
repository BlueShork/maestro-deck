import { X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { MetricsSparkline } from "@/components/MetricsSparkline";
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
          <div className="truncate text-[11px] text-foreground/80">
            {pkg ?? "—"}
          </div>
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
          <div className="text-muted-foreground">
            Connect a device to monitor performance.
          </div>
        ) : stopped ? (
          <div className="text-red-600 dark:text-red-400">
            Monitoring stopped ({stopped}).
          </div>
        ) : samples.length === 0 ? (
          <div className="text-muted-foreground">Waiting for samples…</div>
        ) : (
          <div className="space-y-3">
            <Card
              label="CPU"
              value={last?.cpuPct.toFixed(1) ?? "—"}
              unit="%"
              series={samples.map((s) => s.cpuPct)}
            />
            <Card
              label="RAM"
              value={last?.memMb.toFixed(0) ?? "—"}
              unit="MB"
              series={samples.map((s) => s.memMb)}
            />
            <Card
              label="FPS"
              value={last?.fps != null ? last.fps.toFixed(0) : "—"}
              unit=""
              series={samples.map((s) => s.fps)}
            />
            <Card
              label="Jank"
              value={last?.jankPct != null ? last.jankPct.toFixed(1) : "—"}
              unit="%"
              series={samples.map((s) => s.jankPct)}
            />
            <Card
              label="Net ↓"
              value={last?.netRxKbps.toFixed(1) ?? "—"}
              unit="KB/s"
              series={samples.map((s) => s.netRxKbps)}
            />
            <Card
              label="Net ↑"
              value={last?.netTxKbps.toFixed(1) ?? "—"}
              unit="KB/s"
              series={samples.map((s) => s.netTxKbps)}
            />
          </div>
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
}: {
  label: string;
  value: string;
  unit: string;
  series: (number | null)[];
}) {
  return (
    <div>
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
  );
}
