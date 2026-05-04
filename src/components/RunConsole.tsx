import { Activity, Eraser, Play, Square } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/Button";
import { renderAnsi } from "@/lib/ansi";
import { humanLabel, formatDuration } from "@/lib/stepRenderer";
import { cn } from "@/lib/utils";
import { useRunStore } from "@/stores/runStore";
import type { StepRunState } from "@/stores/runStore";
import { useMetricsStore } from "@/stores/metricsStore";
import { useSettingsStore } from "@/stores/settingsStore";

export function RunConsole({ onRun, onStop }: { onRun: () => void; onStop: () => void }) {
  const running = useRunStore((s) => s.running);
  const exitCode = useRunStore((s) => s.exitCode);
  const logs = useRunStore((s) => s.logs);
  const clearLogs = useRunStore((s) => s.clearLogs);

  const perfEnabled = useSettingsStore((s) => s.perfMonitoringEnabled);
  const panelOpen = useMetricsStore((s) => s.panelOpen);
  const togglePanel = useMetricsStore((s) => s.togglePanel);

  const consoleMode = useSettingsStore((s) => s.consoleMode);
  const setConsoleMode = useSettingsStore((s) => s.setConsoleMode);
  const steps = useRunStore((s) => s.steps);
  const stopRequested = useRunStore((s) => s.stopRequested);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  return (
    <section className="flex h-48 shrink-0 flex-col border-t border-border bg-muted/40">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Console
          </span>
          {running ? (
            <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 dark:bg-emerald-400" />
              running
            </span>
          ) : exitCode !== null ? (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[10px]",
                exitCode === 0
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-red-500/15 text-red-700 dark:text-red-300",
              )}
            >
              exit {exitCode}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <div className="mr-1 flex overflow-hidden rounded border border-border">
            <button
              type="button"
              onClick={() => setConsoleMode("simple")}
              className={cn(
                "px-2 py-0.5 text-[10px]",
                consoleMode === "simple"
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:bg-muted",
              )}
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => setConsoleMode("technical")}
              className={cn(
                "px-2 py-0.5 text-[10px]",
                consoleMode === "technical"
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:bg-muted",
              )}
            >
              Technical
            </button>
          </div>
          {perfEnabled && (
            <Button
              size="xs"
              variant={panelOpen ? "default" : "ghost"}
              onClick={togglePanel}
              title="Toggle performance HUD"
            >
              <Activity className="h-3 w-3" />
              Perf
            </Button>
          )}
          <Button size="xs" variant="ghost" onClick={clearLogs} disabled={logs.length === 0}>
            <Eraser className="h-3 w-3" />
            Clear
          </Button>
          {running ? (
            <Button size="xs" variant="destructive" onClick={onStop}>
              <Square className="h-3 w-3" fill="currentColor" />
              Stop
            </Button>
          ) : (
            <Button size="xs" variant="default" onClick={onRun}>
              <Play className="h-3 w-3" fill="currentColor" />
              Run
            </Button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="allow-select min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed"
      >
        {consoleMode === "technical" ? (
          logs.length === 0 ? (
            <div className="text-muted-foreground">
              No output yet. Press Run to execute the current flow.
            </div>
          ) : (
            logs.map((l) => (
              <div
                key={l.id}
                className={cn(
                  "whitespace-pre-wrap",
                  l.stream === "stderr" && "text-red-700 dark:text-red-300",
                  l.stream === "system" && "text-muted-foreground italic",
                )}
              >
                {renderAnsi(l.text)}
              </div>
            ))
          )
        ) : (
          <SimpleConsoleBody
            steps={steps}
            running={running}
            exitCode={exitCode}
            stopRequested={stopRequested}
          />
        )}
      </div>
    </section>
  );
}

function SimpleConsoleBody({
  steps,
  running,
  exitCode,
  stopRequested,
}: {
  steps: StepRunState[];
  running: boolean;
  exitCode: number | null;
  stopRequested: boolean;
}) {
  if (steps.length === 0) {
    return (
      <div className="text-muted-foreground">
        No output yet. Press Run to execute the current flow.
      </div>
    );
  }
  const failedAt = steps.findIndex((s) => s.status === "failed");
  const totalMs = steps.reduce((acc, s) => acc + (s.durationMs ?? 0), 0);
  return (
    <div className="space-y-0.5">
      {steps.map((s) => (
        <SimpleStepLine key={s.index} step={s} />
      ))}
      {!running && exitCode !== null && (
        <SimpleSummary
          exitCode={exitCode}
          stopRequested={stopRequested}
          totalSteps={steps.length}
          totalMs={totalMs}
          failedAt={failedAt}
        />
      )}
    </div>
  );
}

function SimpleStepLine({ step }: { step: StepRunState }) {
  const icon =
    step.status === "running"
      ? "▶"
      : step.status === "done"
        ? "✓"
        : step.status === "failed"
          ? "✗"
          : " ";
  const colorClass =
    step.status === "done"
      ? "text-emerald-600 dark:text-emerald-400"
      : step.status === "failed"
        ? "text-red-600 dark:text-red-400"
        : step.status === "running"
          ? "text-blue-600 dark:text-blue-400"
          : "text-muted-foreground";
  const label = humanLabel(step);
  const duration = step.status === "running" ? "…" : formatDuration(step.durationMs);
  return (
    <div className={cn("flex items-baseline gap-2 whitespace-pre", colorClass)}>
      <span className="w-3 text-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className="tabular-nums text-muted-foreground">{duration}</span>
      {step.status === "failed" && step.error ? (
        <span className="ml-2 truncate text-red-500/80" title={step.error}>
          — {step.error}
        </span>
      ) : null}
    </div>
  );
}

function SimpleSummary({
  exitCode,
  stopRequested,
  totalSteps,
  totalMs,
  failedAt,
}: {
  exitCode: number;
  stopRequested: boolean;
  totalSteps: number;
  totalMs: number;
  failedAt: number;
}) {
  if (stopRequested) {
    return <div className="mt-2 text-muted-foreground">⏹  Test stopped</div>;
  }
  if (exitCode === 0 && failedAt === -1) {
    return (
      <div className="mt-2 text-emerald-600 dark:text-emerald-400">
        ✅  Test passed — {totalSteps} step{totalSteps === 1 ? "" : "s"} in{" "}
        {formatDuration(totalMs) || "<0.1s"}
      </div>
    );
  }
  return (
    <div className="mt-2 text-red-600 dark:text-red-400">
      ❌  Test failed{failedAt >= 0 ? ` at step ${failedAt + 1}` : ""}
    </div>
  );
}
