// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Loader2, Stethoscope } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { ipc } from "@/lib/ipc";
import { toast } from "@/stores/toastStore";
import type { HealthReport, KillReport } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serial: string;
  report: HealthReport;
}

export function HealthcheckModal({ open, onOpenChange, serial, report }: Props) {
  const [killing, setKilling] = useState(false);
  const [result, setResult] = useState<KillReport | null>(null);

  const onKill = async () => {
    setKilling(true);
    try {
      const r = await ipc.killMaestroProcesses(serial, report);
      setResult(r);
      const summary = [
        r.driver_killed && "driver killed",
        r.port_unforwarded && "port 7001 released",
        r.orphans_killed.length > 0 && `${r.orphans_killed.length} orphan(s) killed`,
      ]
        .filter(Boolean)
        .join(", ");
      if (r.errors.length === 0) {
        toast.success("Device cleaned", summary || "no actions needed");
      } else {
        toast.error("Cleanup partial", r.errors.join("; "));
      }
    } catch (err) {
      toast.error("Kill failed", err instanceof Error ? err.message : String(err));
    } finally {
      setKilling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            Maestro residue detected
          </DialogTitle>
          <DialogDescription>
            The following Maestro artifacts are still present on{" "}
            <span className="font-mono">{serial}</span>. Kill them to recover without restarting
            Maestro Deck.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-1 text-sm">
          {report.driver_running !== null && (
            <li>
              · Driver app <span className="font-mono">dev.mobile.maestro</span> running (pid{" "}
              {report.driver_running})
            </li>
          )}
          {report.port_forwarded !== null && (
            <li>
              · Port forwarding active: <span className="font-mono">{report.port_forwarded}</span>
            </li>
          )}
          {report.orphan_processes.map((p) => (
            <li key={p.pid}>
              · Orphan process <span className="font-mono">{p.name}</span> (pid {p.pid})
            </li>
          ))}
        </ul>

        {result && (
          <div className="rounded border border-border bg-muted/30 p-2 text-xs">
            <div>Driver killed: {String(result.driver_killed)}</div>
            <div>Port released: {String(result.port_unforwarded)}</div>
            <div>Orphans killed: {result.orphans_killed.join(", ") || "—"}</div>
            {result.orphans_skipped.length > 0 && (
              <div>
                Skipped: {result.orphans_skipped.map(([pid, why]) => `${pid} (${why})`).join(", ")}
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="text-destructive">Errors: {result.errors.join("; ")}</div>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {result ? (
            <Button onClick={() => onOpenChange(false)}>OK</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={killing}>
                Cancel
              </Button>
              <Button onClick={onKill} disabled={killing}>
                {killing ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Killing…
                  </>
                ) : (
                  "Kill processes"
                )}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
