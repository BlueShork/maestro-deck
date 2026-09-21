// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Gift } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { useCloudInviteStore } from "@/stores/cloudInviteStore";

/**
 * Shown once, just after the user's first successful run — the point where
 * they've seen the tool work and the offer is worth something. Asking at
 * launch instead would interrupt people who haven't decided they like it yet,
 * and asking again later would make a source-available tool feel like nagware.
 * Declining is final: the store never offers a second time.
 */
export function CloudInviteDialog() {
  const navigate = useNavigate();
  const open = useCloudInviteStore((s) => s.open);
  const close = useCloudInviteStore((s) => s.close);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-sm">
        <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/30 dark:text-emerald-400">
          <Gift className="h-5 w-5" />
        </span>

        <DialogTitle>Run that flow on real devices</DialogTitle>
        <DialogDescription className="mt-1.5">
          Maestro Deck Cloud runs your flows on managed iOS and Android devices, so you can test
          hardware you don't own. New accounts get 20 runs free — no card needed.
        </DialogDescription>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={close}>
            Not now
          </Button>
          <Button
            size="sm"
            onClick={() => {
              close();
              navigate("/account");
            }}
          >
            Create free account
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
