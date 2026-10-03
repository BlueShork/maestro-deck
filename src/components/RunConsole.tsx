// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Activity, Eraser, List, Terminal } from "lucide-react";
import { memo, useEffect, useRef } from "react";

import { PanelAction, PanelHeader } from "@/components/PanelHeader";
import { RunStatus } from "@/components/RunStatus";
import { MetricsBody } from "@/components/MetricsPanel";
import { renderAnsi } from "@/lib/ansi";
import { humanLabel, formatDuration } from "@/lib/stepRenderer";
import { cn } from "@/lib/utils";
import { useRunStore } from "@/stores/runStore";
import type { StepRunState } from "@/stores/runStore";
import { useSettingsStore, type ConsoleMode } from "@/stores/settingsStore";

/** Plain-language outcome of the last run instead of a raw `exit N` code,
 *  as a square Space Mono chip like the landing's status tags. */
function RunStatusBadge({ exitCode, stopped }: { exitCode: number; stopped: boolean }) {
  const kind = stopped ? "stopped" : exitCode === 0 ? "passed" : "failed";
  const { label, className } = {
    passed: { label: "Passed", className: "bg-success/15 text-success" },
    failed: { label: "Failed", className: "bg-destructive/15 text-destructive" },
    stopped: { label: "Stopped", className: "bg-warning/15 text-warning" },
  }[kind];
  return (
    <span
      className={cn("px-1.5 py-0.5 font-mono text-[10px] uppercase leading-none", className)}
      title={`Flow ${label.toLowerCase()} — exit code ${exitCode}`}
    >
      {label}
    </span>
  );
}

/** Landing CI-demo status pip (see `.step-pip` in globals.css). */
function StepPip({ status }: { status: StepRunState["status"] }) {
  return <span aria-hidden className={cn("step-pip", `step-pip-${status}`)} />;
}

const CONSOLE_TABS: Array<{ id: ConsoleMode; label: string; icon: typeof List }> = [
  { id: "simple", label: "Simple", icon: List },
  { id: "technical", label: "Technical", icon: Terminal },
  { id: "performance", label: "Performance", icon: Activity },
];

export function RunConsole() {
  const running = useRunStore((s) => s.running);
  const exitCode = useRunStore((s) => s.exitCode);
  const logs = useRunStore((s) => s.logs);
  const truncatedCount = useRunStore((s) => s.truncatedCount);
  const clearConsole = useRunStore((s) => s.clearConsole);

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
    <section className="flex h-full min-h-0 flex-col bg-background">
      <PanelHeader
        title="Console"
        meta={
          running ? (
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-brand">
              <span className="h-1.5 w-1.5 animate-pulse bg-brand" />
              running
            </span>
          ) : exitCode !== null ? (
            <RunStatusBadge exitCode={exitCode} stopped={stopRequested} />
          ) : null
        }
      >
        {/* View tabs are header cells, lit like the landing's active nav item. */}
        <div role="group" aria-label="Console view" className="flex items-stretch">
          {CONSOLE_TABS.map(({ id, label, icon: Icon }) => (
            <PanelAction
              key={id}
              wide
              active={consoleMode === id}
              aria-pressed={consoleMode === id}
              onClick={() => setConsoleMode(id)}
            >
              <Icon className="h-3 w-3" />
              {label}
            </PanelAction>
          ))}
        </div>
        <PanelAction
          wide
          onClick={clearConsole}
          // Disabled while running: clearing `steps` mid-run would wipe the
          // live step list and incoming events can't repopulate it.
          disabled={running || (logs.length === 0 && steps.length === 0)}
        >
          <Eraser className="h-3 w-3" />
          Clear
        </PanelAction>
      </PanelHeader>

      <RunStatus />

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="allow-select min-h-0 flex-1 overflow-auto px-3 py-2 text-[11px] leading-relaxed"
      >
        {consoleMode === "performance" ? (
          <MetricsBody />
        ) : consoleMode === "technical" ? (
          logs.length === 0 ? (
            <div className="text-muted-foreground">
              No output yet. Press Run to execute the current flow.
            </div>
          ) : (
            <>
              {truncatedCount > 0 ? (
                <div className="italic text-muted-foreground">
                  [{truncatedCount} older lines dropped — console keeps the last 2000]
                </div>
              ) : null}
              {logs.map((l) => (
                <div
                  key={l.id}
                  className={cn(
                    "whitespace-pre-wrap font-mono",
                    l.stream === "stderr" && "text-red-600 dark:text-red-400",
                    l.stream === "system" && "text-muted-foreground italic",
                  )}
                >
                  {renderAnsi(l.text)}
                </div>
              ))}
            </>
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

// Memoized so log lines streaming into the store (which re-render RunConsole)
// don't re-render the whole step list — only an actual step change does.
const SimpleConsoleBody = memo(function SimpleConsoleBody({
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
    <div className="-mx-2">
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
});

// Memoized: steps are updated immutably (unchanged steps keep their reference),
// so only the step whose status/duration changed re-renders.
const SimpleStepLine = memo(function SimpleStepLine({ step }: { step: StepRunState }) {
  const colorClass =
    step.status === "done"
      ? "text-foreground"
      : step.status === "failed"
        ? "text-destructive"
        : step.status === "running"
          ? "text-foreground"
          : "text-muted-foreground";
  const label = humanLabel(step);
  const duration =
    step.status === "running"
      ? "…"
      : step.status === "skipped"
        ? "skipped"
        : formatDuration(step.durationMs);
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 whitespace-pre border-l-2 border-transparent px-2 py-0.5",
        step.status === "running" && "border-l-brand bg-brand/10",
        colorClass,
      )}
    >
      <StepPip status={step.status} />
      <span className="flex-1 truncate">{label}</span>
      <span className="tabular-nums text-muted-foreground">{duration}</span>
      {step.status === "failed" && step.error ? (
        <span className="ml-2 truncate text-destructive/80" title={step.error}>
          — {step.error}
        </span>
      ) : null}
    </div>
  );
});

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
  // Landing CI result banner: a tinted hairline box with the verdict in bold.
  const banner = "mt-3 flex items-center gap-2.5 border px-3 py-2";
  if (stopRequested) {
    return (
      <div className={cn(banner, "border-warning/35 bg-warning/10 text-muted-foreground")}>
        <StepPip status="skipped" />
        <b className="font-semibold text-warning">Test stopped</b>
      </div>
    );
  }
  if (exitCode === 0 && failedAt === -1) {
    return (
      <div className={cn(banner, "border-success/35 bg-success/10 text-muted-foreground")}>
        <StepPip status="done" />
        <b className="font-semibold text-success">Test passed</b>
        {totalSteps} step{totalSteps === 1 ? "" : "s"} in {formatDuration(totalMs) || "<0.1s"}
      </div>
    );
  }
  return (
    <div className={cn(banner, "border-destructive/35 bg-destructive/10 text-muted-foreground")}>
      <StepPip status="failed" />
      <b className="font-semibold text-destructive">Test failed</b>
      {failedAt >= 0 ? `at step ${failedAt + 1}` : null}
    </div>
  );
}
