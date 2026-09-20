// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { ArrowLeft, LogOut, Mail } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import {
  createAccountWithEmail,
  getCloudAuthErrorMessage,
  loginWithEmail,
  logout,
} from "@/lib/cloudAuth";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";

/** Full-screen account page. Mirrors SettingsPage's shell (back button +
 *  Escape to return) but has a single pane: sign-in when signed out,
 *  profile info when signed in. */
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

      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-6">
        {user ? <ProfilePanel email={user.email} /> : <LoginForm />}
      </div>
    </div>
  );
}

function ProfilePanel({ email }: { email: string | null }) {
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
          <Mail className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium leading-tight">Signed in</div>
          <div className="truncate text-xs text-muted-foreground">{email ?? "unknown"}</div>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        disabled={signingOut}
        onClick={() => {
          setSigningOut(true);
          void logout().finally(() => setSigningOut(false));
        }}
        className="mt-5 w-full gap-1.5"
      >
        <LogOut className="h-3.5 w-3.5" />
        {signingOut ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}

function LoginForm() {
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
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4">
        <div className="text-sm font-semibold">Sign in to Maestro Deck Cloud</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          Optional — connect your account to see it here.
        </div>
      </div>

      <form className="space-y-3" onSubmit={(e) => void handleSubmit(e)}>
        <label className="block text-xs text-muted-foreground">
          Email address
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="you@example.com"
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Password
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === "create" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="At least 6 characters"
          />
        </label>

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
          className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {mode === "create" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </form>
    </div>
  );
}
