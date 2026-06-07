// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { events, ipc } from "@/lib/ipc";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Confirms quitting the app. The backend holds the window-close / Cmd+Q exit
 * and emits `quit-requested`; we either ask the user (default) or, if they
 * opted out, quit straight away. Either path ends in `ipc.confirmQuit()`, which
 * tears every session down before the process exits — so a fast quit never
 * leaves orphaned studio / chromedriver / Chrome / iproxy processes behind.
 */
export function QuitConfirmDialog() {
  const [open, setOpen] = useState(false);
  // Local checkbox state; only persisted (opt out of the prompt) if the user
  // actually proceeds with the quit.
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const quittingRef = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void events
      .onQuitRequested(() => {
        if (quittingRef.current) return;
        // Read the live value, not a stale closure.
        if (!useSettingsStore.getState().confirmBeforeQuit) {
          quittingRef.current = true;
          void ipc.confirmQuit();
          return;
        }
        setDontAskAgain(false);
        setOpen(true);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const onConfirm = () => {
    if (dontAskAgain) useSettingsStore.getState().setConfirmBeforeQuit(false);
    quittingRef.current = true;
    setOpen(false);
    void ipc.confirmQuit();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Quit Maestro Deck?</DialogTitle>
          <DialogDescription>
            Any running device, simulator, or browser session will be stopped.
          </DialogDescription>
        </DialogHeader>

        <label className="mt-1 flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-primary"
            checked={dontAskAgain}
            onChange={(e) => setDontAskAgain(e.target.checked)}
          />
          Don&apos;t ask me again
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            Quit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
