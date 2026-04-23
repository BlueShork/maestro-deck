import { Eraser, Play, Square } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/Button";
import { renderAnsi } from "@/lib/ansi";
import { cn } from "@/lib/utils";
import { useRunStore } from "@/stores/runStore";

export function RunConsole({
  onRun,
  onStop,
}: {
  onRun: () => void;
  onStop: () => void;
}) {
  const running = useRunStore((s) => s.running);
  const exitCode = useRunStore((s) => s.exitCode);
  const logs = useRunStore((s) => s.logs);
  const clearLogs = useRunStore((s) => s.clearLogs);

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
          <Button
            size="xs"
            variant="ghost"
            onClick={clearLogs}
            disabled={logs.length === 0}
          >
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
          stickRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed"
      >
        {logs.length === 0 ? (
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
        )}
      </div>
    </section>
  );
}
