// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { openUrl } from "@tauri-apps/plugin-opener";
import { Maximize2, Sparkles } from "lucide-react";
import { useState } from "react";

import { PixelExternal, PixelMosaic } from "@/components/brand/Pixel";
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

/**
 * "Meet Billy" card for the iPhone app. The app installs from a phone, so the
 * QR code is on the card itself — one glance, one scan. Clicking it opens a
 * larger copy for cameras that struggle with the small one.
 */
export function BillyAppPromo() {
  const [qrOpen, setQrOpen] = useState(false);

  return (
    <>
      {/* Landing "Mobile" product panel: copy on the base tone, the phone
          rising out of a red block mosaic. */}
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-4 p-6">
            <span className="mono-label inline-flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-brand" />
              Billy for iPhone
            </span>
            <div>
              <h2 className="font-display text-2xl font-medium leading-tight tracking-[-0.03em]">
                Meet Billy, your Maestro expert
              </h2>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Ask by text or out loud, anytime. Billy knows Maestro, Maestro Deck and the Cloud.
              </p>
            </div>

            <div className="mt-auto flex items-center gap-4">
              <button
                type="button"
                onClick={() => setQrOpen(true)}
                aria-label="Enlarge the App Store QR code"
                className="group relative shrink-0 border border-border bg-white p-2 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <img
                  src="/promo/billy-app-qr.svg"
                  alt="QR code to the Maestro Deck app on the App Store"
                  className="block h-20 w-20 [image-rendering:pixelated]"
                  draggable={false}
                />
                <span className="absolute -right-px -top-px flex h-5 w-5 items-center justify-center bg-brand text-brand-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  <Maximize2 className="h-2.5 w-2.5" />
                </span>
              </button>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Scan with your iPhone camera</span>
                <button
                  type="button"
                  onClick={() => void openUrl(BILLY_APP_STORE_URL)}
                  className="inline-flex items-center gap-1.5 self-start font-mono text-[11px] uppercase text-muted-foreground transition-colors hover:text-foreground"
                >
                  or open the App Store
                  <PixelExternal />
                </button>
              </div>
            </div>
          </div>

          <PixelMosaic
            cols={8}
            rows={6}
            palette="red"
            seed={11}
            className="hidden w-64 items-end justify-center border-l border-border pt-6 sm:flex"
          >
            <img
              src="/promo/billy-phone.webp"
              alt=""
              aria-hidden
              className="relative w-44 translate-y-px"
              draggable={false}
            />
          </PixelMosaic>
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
          <div className="mx-auto my-2 w-fit border border-border bg-white p-4">
            <img
              src="/promo/billy-app-qr.svg"
              alt="QR code to the Maestro Deck app on the App Store"
              className="block h-52 w-52 [image-rendering:pixelated]"
              draggable={false}
            />
          </div>
          <div className="mt-3 flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void openUrl(BILLY_APP_STORE_URL)}
              className="gap-2"
            >
              Open in App Store
              <PixelExternal />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
