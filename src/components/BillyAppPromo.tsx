// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, Maximize2, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";

/** No country in the path: Apple redirects to the scanning phone's own
 *  storefront. public/promo/billy-app-qr.svg encodes this exact URL —
 *  regenerate it if this changes. */
const BILLY_APP_STORE_URL = "https://apps.apple.com/app/id6780199621";

/** Navy of the Billy ad artwork, so the phone crop blends into the card. */
const BILLY_NAVY = "#171C30";

/**
 * "Meet Billy" card for the iPhone app. The app installs from a phone, so the
 * QR code is on the card itself — one glance, one scan. Clicking it opens a
 * larger copy for cameras that struggle with the small one.
 */
export function BillyAppPromo() {
  const [qrOpen, setQrOpen] = useState(false);

  return (
    <>
      <section
        className="relative overflow-hidden rounded-xl border border-border text-white"
        style={{
          backgroundColor: BILLY_NAVY,
          backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-4 p-6">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/50">
              <Sparkles className="h-3 w-3" />
              Billy for iPhone
            </span>
            <div>
              <h2 className="text-2xl font-bold leading-tight tracking-tight">
                Meet <span className="rounded-md bg-white px-1.5 text-[#0B0B0B]">Billy</span>, your
                Maestro expert
              </h2>
              <p className="mt-2 max-w-sm text-sm text-white/60">
                Ask by text or out loud, anytime. Billy knows Maestro, Maestro Deck and the Cloud.
              </p>
            </div>

            <div className="mt-auto flex items-center gap-4">
              <button
                type="button"
                onClick={() => setQrOpen(true)}
                aria-label="Enlarge the App Store QR code"
                className="group relative shrink-0 rounded-lg bg-white p-2 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <img
                  src="/promo/billy-app-qr.svg"
                  alt="QR code to the Maestro Deck app on the App Store"
                  className="block h-20 w-20 [image-rendering:pixelated]"
                  draggable={false}
                />
                <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#0B0B0B] text-white opacity-0 ring-2 ring-white transition-opacity group-hover:opacity-100">
                  <Maximize2 className="h-2.5 w-2.5" />
                </span>
              </button>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">Scan with your iPhone camera</span>
                <button
                  type="button"
                  onClick={() => void openUrl(BILLY_APP_STORE_URL)}
                  className="inline-flex items-center gap-0.5 self-start text-xs text-white/60 transition-colors hover:text-white"
                >
                  or open the App Store
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>

          {/* The phone from the ad, rising from the card's bottom edge. */}
          <div className="hidden items-end pr-8 pt-6 sm:flex">
            <img
              src="/promo/billy-phone.webp"
              alt=""
              aria-hidden
              className="w-48 translate-y-px"
              draggable={false}
            />
          </div>
        </div>
      </section>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="items-center text-center">
            <DialogTitle>Get Billy on your iPhone</DialogTitle>
            <DialogDescription>
              Point your iPhone camera at the code to open Maestro Deck on the App Store.
            </DialogDescription>
          </DialogHeader>
          {/* White tile in both themes: scanners want dark modules on light. */}
          <div className="mx-auto my-2 w-fit rounded-2xl bg-white p-4 shadow-sm ring-1 ring-border">
            <img
              src="/promo/billy-app-qr.svg"
              alt="QR code to the Maestro Deck app on the App Store"
              className="block h-52 w-52 [image-rendering:pixelated]"
              draggable={false}
            />
          </div>
          <div className="mt-3 flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void openUrl(BILLY_APP_STORE_URL)}
              className="gap-1.5 text-muted-foreground"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              Open in App Store
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
