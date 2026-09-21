// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { openUrl } from "@tauri-apps/plugin-opener";
import { Gift } from "lucide-react";
import { useNavigate } from "react-router-dom";

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

/** The travelling edge light. Mostly empty so a single beam sweeps the border
 *  rather than the whole outline glowing — emerald is the app's accent, set on
 *  --ring and used across the components, so the card reads as part of the app
 *  rather than an ad pasted into it. */
const BEAM_GRADIENT =
  "bg-[conic-gradient(from_0deg,transparent_0deg,transparent_236deg,#10b981_306deg,#a7f3d0_344deg,transparent_360deg)]";

interface Promo {
  /** Rendered large when present — for this card the number *is* the message. */
  count: string | null;
  label: string;
  sub: string;
  cta: string;
  aria: string;
}

/**
 * The in-app storefront entry, sat under Cloud in the device sidebar. It
 * follows the funnel rather than showing one fixed pitch: strangers get the
 * free grant, free users get the upgrade, paying users get a top-up. Signing
 * in stays optional everywhere else in the app, so this card is the one place
 * that actually asks.
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
      className="group relative w-full overflow-hidden rounded-xl bg-border p-px text-left transition-transform duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:hover:-translate-y-0.5"
    >
      {/* Beam layer: oversized square so the rotating cone always covers the
          card's corners, clipped back to the rounded rect by the parent. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[240%] opacity-90 motion-safe:animate-[cloud-beam-spin_6s_linear_infinite] ${BEAM_GRADIENT}`}
        style={{ transform: "translate(-50%, -50%)" }}
      />

      {/* Body sits above the beam and covers all but the 1px padding ring. */}
      <span className="relative block overflow-hidden rounded-[11px] bg-card p-3">
        <span
          aria-hidden
          className="pointer-events-none absolute -left-8 -top-10 h-28 w-28 rounded-full bg-emerald-500/25 blur-2xl motion-safe:animate-[cloud-glow-breathe_7s_ease-in-out_infinite]"
        />

        <span className="relative block">
          <span className="mb-2.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/30 dark:text-emerald-400">
            <Gift className="h-4 w-4" />
          </span>

          <span className="flex flex-wrap items-baseline gap-x-1.5">
            {promo.count ? (
              <span className="text-[26px] font-bold leading-none tracking-tight tabular-nums text-foreground">
                {promo.count}
              </span>
            ) : null}
            <span className="text-xs font-semibold text-foreground">{promo.label}</span>
          </span>

          <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
            {promo.sub}
          </span>

          <span className="mt-3 block rounded-md bg-emerald-500 px-2.5 py-1.5 text-center text-[11px] font-semibold text-emerald-950 transition-colors group-hover:bg-emerald-400">
            {promo.cta}
          </span>
        </span>
      </span>
    </button>
  );
}

function resolvePromo(user: CloudUser | null, billing: CloudBillingInfo | null): Promo {
  if (!user) {
    return {
      count: String(FREE_GRANT_RUNS),
      label: "free cloud runs",
      sub: "Run your flows on real devices. No card needed.",
      cta: "Create free account",
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
    cta: "Buy runs",
    aria: "Buy more Maestro Deck Cloud runs",
  };
}
