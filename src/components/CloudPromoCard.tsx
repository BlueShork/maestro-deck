// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { openUrl } from "@tauri-apps/plugin-opener";
import { useNavigate } from "react-router-dom";

import { PixelChevron, PixelMosaic } from "@/components/brand/Pixel";
import { cn } from "@/lib/utils";

import {
  CLOUD_BILLING_URL,
  tierLabel,
  type CloudBillingInfo,
  type CloudUser,
} from "@/lib/cloudAuth";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";

/** Matches FREE_TIER_GRANT_RUNS in maestro-nightly/dashboard/lib/billing-constants.ts
 *  and the "20 free runs" the marketing site already promises. */
const FREE_GRANT_RUNS = 20;

interface Promo {
  /** Rendered large when present — for this card the number *is* the message. */
  count: string | null;
  label: string;
  sub: string;
  cta: string;
  aria: string;
  /** How close the balance is to empty; drives the colour. */
  tone: "normal" | "low" | "empty";
}

/** At or below this many runs the balance turns amber: time to top up. */
const LOW_RUNS = 3;

/**
 * The cloud balance, parked at the foot of the device sidebar, cut into cells
 * like the landing: a strip of warm bands, the figure in Inter Tight beside a
 * small block mosaic, and the call to action as a light full-width cell. The
 * mosaic and the figure warm up (amber, then red) as the balance runs out.
 *
 * It still follows the funnel — strangers get the free grant, signed-in users
 * get their balance — because signing in is optional everywhere else, so this
 * is the one surface that asks.
 */
export function CloudPromoCard() {
  const navigate = useNavigate();
  const user = useCloudAuthStore((s) => s.user);
  const billing = useCloudAuthStore((s) => s.billing);

  const promo = resolvePromo(user, billing);
  // Signed out there is nothing to buy yet — send them to the account page to
  // create one. Once signed in, the money lives on the dashboard.
  const onClick = user ? () => void openUrl(CLOUD_BILLING_URL) : () => navigate("/account");

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={promo.aria}
      className="group flex w-full flex-col text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {/* Three warm bands, the landing footer in miniature. */}
      <span aria-hidden className="flex flex-col">
        <span className="h-0.5 bg-warm-amber" />
        <span className="h-0.5 bg-warm-orange" />
        <span className="h-0.5 bg-warm-red" />
      </span>

      <span className="flex items-stretch">
        <span className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-3">
          <span className="flex items-baseline gap-2">
            {promo.count ? (
              <span
                className={cn(
                  "font-display text-[34px] font-medium leading-none tracking-[-0.045em] tabular-nums",
                  promo.tone === "empty"
                    ? "text-destructive"
                    : promo.tone === "low"
                      ? "text-warning"
                      : "text-foreground",
                )}
              >
                {promo.count}
              </span>
            ) : null}
            <span className="mono-label text-[10px]">{promo.label}</span>
          </span>
          <span className="text-[11px] leading-snug text-muted-foreground">{promo.sub}</span>
        </span>
        <PixelMosaic
          cols={3}
          rows={4}
          seed={7}
          palette={promo.tone === "empty" ? "red" : promo.tone === "low" ? "yellow" : "orange"}
          className="w-14 shrink-0 border-l border-border"
        />
      </span>

      <span className="flex h-10 items-center justify-between border-t border-border bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors group-hover:bg-primary/90 dark:group-hover:bg-white">
        {promo.cta}
        <PixelChevron className="transition-transform duration-150 [transition-timing-function:steps(2,end)] group-hover:translate-x-[3px]" />
      </span>
    </button>
  );
}

function resolvePromo(user: CloudUser | null, billing: CloudBillingInfo | null): Promo {
  if (!user) {
    return {
      count: String(FREE_GRANT_RUNS),
      label: "free runs",
      sub: "Run your flows on hosted devices. No card needed.",
      cta: "Create account",
      tone: "normal",
      aria: `Create a free Maestro Deck Cloud account and get ${FREE_GRANT_RUNS} free runs`,
    };
  }

  // Signed in, but the balance hasn't landed yet (or couldn't be reached).
  // Stay useful rather than flashing a zero we don't know to be true.
  if (!billing) {
    return {
      count: null,
      label: "Cloud runs",
      sub: "Checking your balance",
      cta: "Buy runs",
      aria: "Buy more Maestro Deck Cloud runs",
      tone: "normal",
    };
  }

  const runs = billing.runsRemaining;
  return {
    count: String(runs),
    label: runs === 1 ? "run left" : "runs left",
    sub:
      runs === 0
        ? "Top up to keep running in the cloud."
        : billing.currentPack
          ? `${billing.currentPack.displayName} pack`
          : tierLabel(billing.tier),
    cta: runs <= LOW_RUNS ? "Top up runs" : "Buy runs",
    aria: "Buy more Maestro Deck Cloud runs",
    tone: runs === 0 ? "empty" : runs <= LOW_RUNS ? "low" : "normal",
  };
}
