// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { openUrl } from "@tauri-apps/plugin-opener";
import { useNavigate } from "react-router-dom";

import TiltedCard from "@/components/ui/TiltedCard";

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
}

/**
 * The cloud balance, parked at the foot of the device sidebar. It reads as a
 * ledger line rather than an ad: the figure carries the whole card, everything
 * else is set quiet around it, and the only colour is the app's own contrast.
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

  // The sidebar is narrow, so the tilt stays small: a nudge of depth under the
  // cursor, not the full showcase swing, and the figure floats a little above
  // the card face.
  return (
    <TiltedCard scaleOnHover={1.03} rotateAmplitude={10}>
      <button
        type="button"
        onClick={onClick}
        aria-label={promo.aria}
        className="group w-full rounded-lg border border-border bg-card p-3 text-left transition-[border-color,box-shadow] [transform-style:preserve-3d] hover:border-foreground/20 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span className="flex flex-wrap items-baseline gap-x-1.5 [transform-style:preserve-3d] [transform:translateZ(20px)]">
          {promo.count ? (
            <span className="text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
              {promo.count}
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground">{promo.label}</span>
        </span>

        <span className="mt-1.5 block text-[11px] leading-snug text-muted-foreground">
          {promo.sub}
        </span>

        <span className="mt-3 block rounded-md bg-foreground px-2.5 py-1.5 text-center text-[11px] font-medium text-background transition-opacity group-hover:opacity-85">
          {promo.cta}
        </span>
      </button>
    </TiltedCard>
  );
}

function resolvePromo(user: CloudUser | null, billing: CloudBillingInfo | null): Promo {
  if (!user) {
    return {
      count: String(FREE_GRANT_RUNS),
      label: "free runs",
      sub: "Run your flows on hosted devices. No card needed.",
      cta: "Create account",
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
