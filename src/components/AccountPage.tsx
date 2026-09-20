// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  Cloud,
  Gauge,
  LogOut,
  Mail,
  RefreshCw,
  Rocket,
  ShoppingCart,
  Smartphone,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import {
  CLOUD_BILLING_URL,
  createAccountWithEmail,
  getCloudAuthErrorMessage,
  loginWithEmail,
  logout,
  type CloudBillingInfo,
} from "@/lib/cloudAuth";
import { cn } from "@/lib/utils";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";

const TIER_LABELS: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  indie: "Indie",
  pro: "Pro",
  studio: "Studio",
  scale: "Scale",
  enterprise: "Enterprise",
};

function tierLabel(tier: string): string {
  return TIER_LABELS[tier] ?? tier.charAt(0).toUpperCase() + tier.slice(1);
}

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
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
            <Mail className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-semibold leading-tight">{email ?? "unknown"}</span>
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
          className="gap-1.5 text-muted-foreground"
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

      <RoadmapStrip />
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
  const dailyUsedPct =
    billing && billing.dailyCap > 0
      ? Math.min(100, Math.round((billing.runsToday / billing.dailyCap) * 100))
      : 0;

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
          <div className="p-5">
            <div className="text-xs text-muted-foreground">Runs remaining</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums leading-none">
              {loading ? "…" : (billing?.runsRemaining ?? "—")}
            </div>
          </div>
          <div className="p-5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Used today</span>
              <span className="tabular-nums">
                {loading ? "…" : billing ? `${billing.runsToday} / ${billing.dailyCap}` : "—"}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${loading ? 0 : dailyUsedPct}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoadmapStrip() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span className="font-medium text-foreground">Coming to this account soon</span>
      <div className="flex flex-wrap gap-2">
        <RoadmapPill icon={Cloud} label="Run flows in the cloud" />
        <RoadmapPill icon={Smartphone} label="Preview on real devices" />
      </div>
    </div>
  );
}

function RoadmapPill({ icon: Icon, label }: { icon: typeof Cloud; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1">
      <Icon className="h-3 w-3" />
      {label}
    </span>
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
            Connect one if you want your cloud runs and credits visible right here in the app.
          </p>
        </div>

        <ul className="space-y-4">
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
          <Benefit
            icon={Cloud}
            title="Run flows in the cloud"
            description="Kick off a flow from the app and let it run on managed infrastructure."
            comingSoon
          />
          <Benefit
            icon={Smartphone}
            title="Preview on real devices"
            description="Watch a flow execute on a real physical device, streamed back to the app."
            comingSoon
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
  comingSoon,
}: {
  icon: typeof Gauge;
  title: string;
  description: string;
  comingSoon?: boolean;
}) {
  return (
    <li className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          {comingSoon ? (
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Coming soon
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </li>
  );
}

function LoginCard() {
  const [mode, setMode] = useState<"sign-in" | "create">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "create") {
        await createAccountWithEmail(email.trim(), password);
      } else {
        await loginWithEmail(email.trim(), password);
      }
    } catch (err) {
      setError(getCloudAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Sign in</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {mode === "create" ? "Create your free Maestro Deck Cloud account." : "Welcome back."}
        </p>
      </div>

      <form className="space-y-3" onSubmit={(e) => void handleSubmit(e)}>
        <Field label="Email address">
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-8 w-full rounded border border-border bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="you@example.com"
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === "create" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-8 w-full rounded border border-border bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="At least 6 characters"
          />
        </Field>

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="sm" disabled={loading} className="w-full">
          {loading ? "Signing in…" : mode === "create" ? "Create account" : "Continue with email"}
        </Button>
        <button
          type="button"
          onClick={() => setMode((m) => (m === "create" ? "sign-in" : "create"))}
          className={cn(
            "block w-full text-center text-xs text-muted-foreground underline-offset-2",
            "hover:text-foreground hover:underline",
          )}
        >
          {mode === "create" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
