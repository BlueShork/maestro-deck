// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { openUrl } from "@tauri-apps/plugin-opener";
import { type FormEvent, type ReactNode, useState } from "react";

import { PixelChevron } from "@/components/brand/Pixel";
import { Button } from "@/components/ui/Button";
import { createAccountWithEmail, getCloudAuthErrorMessage, loginWithEmail } from "@/lib/cloudAuth";
import { PRIVACY_URL } from "@/lib/telemetry";
import { cn } from "@/lib/utils";

const TERMS_URL = "https://www.maestrodeck.cloud/legal/cgu";

type Mode = "sign-in" | "create";

/**
 * Email sign-in and account creation in one form.
 *
 * Lives on its own so both the account page and the onboarding dialog use the
 * same form: the onboarding must not navigate away mid-flow, and two copies of
 * an auth form is how they drift apart.
 *
 * `page` is the dashboard's login column (large Inter Tight title, tab cells,
 * tall fields, small print); `card` is the compact boxed version for dialogs.
 */
export function LoginCard({ variant = "card" }: { variant?: "card" | "page" }) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const page = variant === "page";

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

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const inputClass = cn(
    "w-full rounded-md border border-input bg-background px-3 outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-brand focus-visible:ring-1 focus-visible:ring-brand",
    page ? "h-11 text-sm" : "h-9 text-xs",
  );

  const form = (
    <form className={page ? "space-y-4" : "space-y-3"} onSubmit={(e) => void handleSubmit(e)}>
      <Field label="Email address" page={page}>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          placeholder="you@example.com"
        />
      </Field>
      <Field label="Password" page={page}>
        <input
          type="password"
          required
          minLength={6}
          autoComplete={mode === "create" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
          placeholder="At least 6 characters"
        />
      </Field>

      {error ? (
        <p className="border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={loading}
        className={cn("group w-full gap-2.5", page ? "h-11 text-sm" : "h-9")}
      >
        {loading
          ? mode === "create"
            ? "Creating your account…"
            : "Signing in…"
          : mode === "create"
            ? "Create account"
            : "Continue with email"}
        {!loading ? (
          <PixelChevron className="transition-transform duration-150 [transition-timing-function:steps(2,end)] group-hover:translate-x-[3px]" />
        ) : null}
      </Button>
    </form>
  );

  const switchLine = (
    <p className={cn("text-muted-foreground", page ? "text-sm" : "text-center text-xs")}>
      {mode === "create" ? "Already have an account? " : "New here? "}
      <button
        type="button"
        onClick={() => switchMode(mode === "create" ? "sign-in" : "create")}
        className="text-foreground underline decoration-brand underline-offset-[3px] transition-colors hover:text-brand"
      >
        {mode === "create" ? "Sign in" : "Create an account"}
      </button>
    </p>
  );

  if (!page) {
    return (
      <div className="warm-bands overflow-hidden rounded-lg border border-border bg-surface p-5 pt-6">
        <div className="mb-4">
          <span className="font-display text-2xl font-medium tracking-[-0.03em]">
            {mode === "create" ? "Create account" : "Sign in"}
          </span>
          <p className="mt-1 text-xs text-muted-foreground">
            {mode === "create" ? "Create your free Maestro Deck Cloud account." : "Welcome back."}
          </p>
        </div>
        {form}
        <div className="mt-3">{switchLine}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <h1 className="font-display text-[48px] font-medium leading-none tracking-[-0.045em]">
        {mode === "create" ? "Create account" : "Log in"}
      </h1>
      <p className="mt-3 text-[15px] text-muted-foreground">
        {mode === "create"
          ? "20 free cloud runs to start. No card needed."
          : "Sign in to run your flows in the cloud."}
      </p>

      {/* Tab cells, lit like the landing's active nav item. */}
      <div role="tablist" className="mb-6 mt-8 grid grid-cols-2 border border-border">
        {(["sign-in", "create"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => switchMode(m)}
            className={cn(
              "h-10 font-mono text-[11px] uppercase transition-colors [&+&]:border-l [&+&]:border-border",
              mode === m
                ? "bg-accent text-foreground shadow-[inset_0_-2px_0_hsl(var(--brand))]"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {m === "sign-in" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      {form}

      <div className="mt-8 border-t border-border pt-6">{switchLine}</div>
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Signing in is optional — Maestro Deck runs fully offline without an account. By continuing,
        you agree to the{" "}
        <button
          type="button"
          onClick={() => void openUrl(TERMS_URL)}
          className="underline underline-offset-2 hover:text-foreground"
        >
          terms
        </button>{" "}
        and{" "}
        <button
          type="button"
          onClick={() => void openUrl(PRIVACY_URL)}
          className="underline underline-offset-2 hover:text-foreground"
        >
          privacy policy
        </button>
        .
      </p>
    </div>
  );
}

/** Label + control, used only by the form above. */
function Field({ label, page, children }: { label: string; page: boolean; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={page ? "text-sm text-foreground/90" : "mono-label"}>{label}</span>
      {children}
    </label>
  );
}
