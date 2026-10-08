// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { useOriginGrantStore } from "@/stores/originGrantStore";

/** Asks whether a plugin may reach a server its manifest does not list. */
export function OriginGrantDialog() {
  const pending = useOriginGrantStore((s) => s.pending);
  const answer = useOriginGrantStore((s) => s.answer);
  const host = pending ? new URL(pending.origin).host : "";

  return (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && answer(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Allow {pending?.pluginName} to connect to {host}?
          </DialogTitle>
          <DialogDescription>
            The plugin will send your requests and data to {pending?.origin}. You can revoke this
            from the Plugins page.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => answer(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => answer(true)}>
            Allow
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
