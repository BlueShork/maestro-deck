// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { openUrl } from "@tauri-apps/plugin-opener";
import { Cloud, Gauge, LogOut, RefreshCw, ShoppingCart, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { BillyAppPromo } from "@/components/BillyAppPromo";
import { Button } from "@/components/ui/Button";
import { CLOUD_BILLING_URL, logout, tierLabel, type CloudBillingInfo } from "@/lib/cloudAuth";
import { LoginCard } from "@/components/LoginCard";
import { PageHeader } from "@/components/PageHeader";
import { PixelChevron, PixelMosaic } from "@/components/brand/Pixel";
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
      <PageHeader title="Maestro Deck Cloud" />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Decorative community banner, edge to edge. Its height is capped so
            a wide window crops the empty top/bottom instead of turning it
            into a wall; the artwork's content sits in the middle. */}
        {user ? (
          <PixelMosaic
            cols={40}
            rows={5}
            palette="orange"
            seed={11}
            className="h-[clamp(120px,14vw,220px)] w-full border-b border-border"
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
            className="flex h-24 w-24 shrink-0 select-none items-center justify-center border border-border bg-background font-display text-5xl font-medium tracking-[-0.04em] text-foreground"
          >
            {(email?.trim()[0] ?? "?").toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-col pb-1.5">
            <span className="truncate font-display text-2xl font-medium leading-tight tracking-[-0.03em]">
              {email ?? "unknown"}
            </span>
            <span className="mono-label mt-1">Signed in to Maestro Deck Cloud</span>
          </div>
        </div>
        <Button
          variant="secondary"
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
    <div className="warm-bands overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-5 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <span className="mono-label">Plan</span>
          <span className="bg-brand px-2 py-0.5 font-mono text-[10px] uppercase text-brand-foreground">
            {loading ? "…" : billing ? tierLabel(billing.tier) : "—"}
          </span>
          {billing?.currentPack && billing.expiresAt ? (
            <span className="text-xs text-muted-foreground">
              · renews {new Date(billing.expiresAt).toLocaleDateString()}
            </span>
          ) : null}
        </div>
        <Button size="sm" onClick={() => void openUrl(CLOUD_BILLING_URL)} className="group gap-2">
          Buy more runs
          <PixelChevron className="transition-transform duration-150 [transition-timing-function:steps(2,end)] group-hover:translate-x-[3px]" />
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
          <Button variant="secondary" size="sm" onClick={onRetry} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className="flex flex-col justify-center p-6">
            <div className="mono-label">Runs remaining</div>
            <div className="mt-3 font-display text-6xl font-medium tabular-nums leading-none tracking-[-0.045em]">
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
              <span className="mono-label">Used today</span>
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

/** Today's usage as the landing's CI bar: one square cell per run of the
 *  daily cap, orange as they are spent, amber once the cap is reached. */
function UsageRing({ used, cap, label }: { used: number; cap: number; label: string }) {
  const full = cap > 0 && used >= cap;
  return (
    <div className="flex w-28 shrink-0 flex-col gap-2">
      <span className="font-display text-2xl font-medium leading-none tracking-[-0.03em] tabular-nums">
        {label}
      </span>
      <div className="flex gap-0.5" aria-hidden>
        {Array.from({ length: Math.max(cap, 1) }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-2 flex-1",
              i < used ? (full ? "bg-warning" : "bg-brand") : "bg-surface",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function PitchView() {
  return (
    <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:items-start">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-[40px] font-medium leading-none tracking-[-0.045em]">
            Maestro Deck Cloud
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Maestro Deck runs fully offline without an account — signing in is entirely optional.
            Connect one to run flows in the cloud and keep your runs and credits right here in the
            app.
          </p>
        </div>

        <ul className="border border-border">
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
    <li className="flex gap-3 px-4 py-3 [&+&]:border-t [&+&]:border-border">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
      <div className="min-w-0">
        <span className="text-sm font-medium">{title}</span>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </li>
  );
}
