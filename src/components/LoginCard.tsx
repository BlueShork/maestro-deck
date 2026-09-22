// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Rocket } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import { Button } from "@/components/ui/Button";
import { createAccountWithEmail, getCloudAuthErrorMessage, loginWithEmail } from "@/lib/cloudAuth";
import { cn } from "@/lib/utils";

/**
 * Email sign-in and account creation in one card.
 *
 * Lives on its own so both the account page and the onboarding dialog use the
 * same form: the onboarding must not navigate away mid-flow, and two copies of
 * an auth form is how they drift apart.
 */
export function LoginCard() {
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

/** Label + control, used only by the form above. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
