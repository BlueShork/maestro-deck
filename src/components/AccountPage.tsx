// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, Cloud, Gauge, LogOut, RefreshCw, ShoppingCart, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { BillyAppPromo } from "@/components/BillyAppPromo";
import { Button } from "@/components/ui/Button";
import { CLOUD_BILLING_URL, logout, tierLabel, type CloudBillingInfo } from "@/lib/cloudAuth";
import { LoginCard } from "@/components/LoginCard";
import { cn } from "@/lib/utils";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";

/** Full-screen account page — the in-app storefront for Maestro Deck Cloud.
 *  Signed out, it's a pitch for what connecting buys you; signed in, it's the
 *  account's live standing (runs, plan, quota) with a direct line to buy more. */
export function AccountPage() {
  const navigate = useNavigate();
  const user = useCloudAuthStore((s) => s.user);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => navigate("/")}
          aria-label="Back to workspace"
          title="Back to workspace (Esc)"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-semibold">Maestro Deck Cloud</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Decorative community banner, edge to edge. Its height is capped so
            a wide window crops the empty top/bottom instead of turning it
            into a wall; the artwork's content sits in the middle. */}
        {user ? (
          <img
            src="/promo/community-banner.webp"
            alt=""
            aria-hidden
            className="block h-[clamp(120px,14vw,220px)] w-full border-b border-border object-cover"
            draggable={false}
          />
        ) : null}
        <div className="mx-auto max-w-3xl px-6 py-10">
          {user ? <ProfileView email={user.email} /> : <PitchView />}
        </div>
      </div>
    </div>
  );
}

function ProfileView({ email }: { email: string | null }) {
  const [signingOut, setSigningOut] = useState(false);
  const billing = useCloudAuthStore((s) => s.billing);
  const billingLoading = useCloudAuthStore((s) => s.billingLoading);
  const billingError = useCloudAuthStore((s) => s.billingError);
  const refreshBilling = useCloudAuthStore((s) => s.refreshBilling);

  useEffect(() => {
    void refreshBilling();
  }, [refreshBilling]);

  return (
    <div className="space-y-6">
      {/* Avatar straddles the banner's bottom edge: pulled up by the
          container's top padding (py-10 = 40px) plus 40px of its 96px. */}
      <div className="relative -mt-20 flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-end gap-4">
          <div
            aria-hidden
            className="flex h-24 w-24 shrink-0 select-none items-center justify-center rounded-full bg-foreground text-4xl font-bold text-background shadow-lg ring-4 ring-background"
          >
            {(email?.trim()[0] ?? "?").toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-col pb-1.5">
            <span className="truncate text-lg font-semibold leading-tight">
              {email ?? "unknown"}
            </span>
            <span className="text-xs text-muted-foreground">Signed in to Maestro Deck Cloud</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void logout().finally(() => setSigningOut(false));
          }}
          className="mb-1 gap-1.5 text-muted-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </div>

      <BillingCard
        billing={billing}
        loading={billingLoading}
        error={billingError}
        onRetry={() => void refreshBilling()}
      />

      <BillyAppPromo />
    </div>
  );
}

function BillingCard({
  billing,
  loading,
  error,
  onRetry,
}: {
  billing: CloudBillingInfo | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Plan</span>
          <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
            {loading ? "…" : billing ? tierLabel(billing.tier) : "—"}
          </span>
          {billing?.currentPack && billing.expiresAt ? (
            <span className="text-xs text-muted-foreground">
              · renews {new Date(billing.expiresAt).toLocaleDateString()}
            </span>
          ) : null}
        </div>
        <Button size="sm" onClick={() => void openUrl(CLOUD_BILLING_URL)} className="gap-1.5">
          <ShoppingCart className="h-3.5 w-3.5" />
          Buy more runs
        </Button>
      </div>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex flex-col">
            <span className="text-sm">Couldn't reach your account</span>
            <span className="text-xs text-muted-foreground">
              Your runs couldn't be loaded ({error}). Buying more still works.
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className="flex flex-col justify-center p-6">
            <div className="text-xs text-muted-foreground">Runs remaining</div>
            <div className="mt-2 text-5xl font-semibold tabular-nums leading-none tracking-tight">
              {loading ? "…" : (billing?.runsRemaining ?? "—")}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Cloud runs left on your account
            </div>
          </div>
          <div className="flex items-center gap-5 p-6">
            <UsageRing
              used={loading ? 0 : (billing?.runsToday ?? 0)}
              cap={billing?.dailyCap ?? 0}
              label={loading ? "…" : billing ? `${billing.runsToday}/${billing.dailyCap}` : "—"}
            />
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Used today</span>
              <span className="mt-1 text-sm font-medium">
                {loading || !billing
                  ? "—"
                  : billing.runsToday >= billing.dailyCap
                    ? "Daily limit reached"
                    : `${billing.dailyCap - billing.runsToday} left today`}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Today's usage as a ring that fills toward the daily cap; amber once full. */
function UsageRing({ used, cap, label }: { used: number; cap: number; label: string }) {
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const ratio = cap > 0 ? Math.min(1, used / cap) : 0;
  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" className="stroke-muted" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className={cn(
            "transition-[stroke-dashoffset] duration-700 ease-out",
            ratio >= 1 ? "stroke-amber-500" : "stroke-primary",
          )}
          // A zero-length round cap still draws a dot; hide the arc at 0.
          opacity={ratio > 0 ? 1 : 0}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
        {label}
      </span>
    </div>
  );
}

function PitchView() {
  return (
    <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:items-start">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Maestro Deck Cloud</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Maestro Deck runs fully offline without an account — signing in is entirely optional.
            Connect one to run flows in the cloud and keep your runs and credits right here in the
            app.
          </p>
        </div>

        <ul className="space-y-4">
          <Benefit
            icon={Cloud}
            title="Run flows in the cloud"
            description="Kick off a flow from the app and let it run on a hosted emulator, simulator or real phone."
          />
          <Benefit
            icon={Smartphone}
            title="Preview on real devices"
            description="Watch a flow execute on a real physical device, streamed back to the app."
          />
          <Benefit
            icon={Gauge}
            title="Track runs & credits"
            description="See how many cloud runs you have left without switching to a browser."
          />
          <Benefit
            icon={ShoppingCart}
            title="Buy more in one click"
            description="Out of runs? Buy more runs without leaving Maestro Deck."
          />
        </ul>
      </div>

      <LoginCard />
    </div>
  );
}

function Benefit({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Gauge;
  title: string;
  description: string;
}) {
  return (
    <li className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <span className="text-sm font-medium">{title}</span>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </li>
  );
}
