// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged as onFirebaseAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";

/**
 * Same Firebase project the Maestro Deck Cloud dashboard uses
 * (maestro-nightly/dashboard/lib/firebase.ts). The web API key is a public
 * client identifier, not a secret — access is enforced by Firebase's own
 * security rules, the same as it is for the dashboard itself.
 */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC_DQDYOfAjCLl-M2xcWj9dUJPyb3tl_MQ",
  authDomain: "maestrodecknightly.firebaseapp.com",
  projectId: "maestrodecknightly",
};

if (!getApps().length) {
  initializeApp(FIREBASE_CONFIG);
}

const auth: Auth = getAuth();

/** Same dashboard the login lives on (maestro-nightly/dashboard/lib/site.ts). */
const DASHBOARD_URL = "https://dashboard.maestrodeck.cloud";

/** The dashboard also hosts the job API, so cloud runs talk to the same origin. */
export const CLOUD_DASHBOARD_URL = DASHBOARD_URL;

/** The bearer token every authed dashboard route expects. Throws rather than
 *  returning null: a caller with no session has nothing useful to do next. */
export async function getCloudIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  try {
    return await user.getIdToken();
  } catch (err) {
    // Refreshing the token goes over the network. Letting Firebase's raw code
    // reach a run's error toast tells the user nothing to do about it.
    throw new Error(getCloudAuthErrorMessage(err), { cause: err });
  }
}

/** Where "buy more runs" sends the user — the dashboard's own billing page,
 *  which already has the pack picker and Stripe checkout. */
export const CLOUD_BILLING_URL = `${DASHBOARD_URL}/billing`;

export type CloudUser = Pick<User, "uid" | "email">;

/** Mirrors TIER_CONFIG in maestro-nightly/dashboard/lib/billing-constants.ts.
 *  Unknown ids fall back to a capitalised form rather than rendering raw, so a
 *  tier added server-side still reads sensibly here until this list catches up. */
const TIER_LABELS: Record<string, string> = {
  free: "Free Tier",
  starter: "Starter",
  indie: "Indie",
  pro: "Pro",
  studio: "Studio",
  scale: "Scale",
  enterprise: "Enterprise",
};

export function tierLabel(tier: string): string {
  return TIER_LABELS[tier] ?? tier.charAt(0).toUpperCase() + tier.slice(1);
}

export interface CloudBillingInfo {
  tier: string;
  runsRemaining: number;
  runsToday: number;
  dailyCap: number;
  currentPack: { id: string; displayName: string } | null;
  expiresAt: string | null;
}

/** Mirrors the response shape of GET /api/billing/me (maestro-nightly/dashboard).
 *  That route already accepts a Firebase ID token via `Authorization: Bearer`,
 *  same as every other authed dashboard route, so no new backend work is needed. */
export async function fetchCloudBilling(): Promise<CloudBillingInfo> {
  // Same translated failure as every other call: the balance and a run must
  // not describe a lost connection in two different vocabularies.
  const token = await getCloudIdToken();
  const res = await fetch(`${DASHBOARD_URL}/api/billing/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("your session expired — sign out and back in");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as CloudBillingInfo;
}

export function isCloudSignedIn(): boolean {
  return auth.currentUser !== null;
}

export function onCloudAuthStateChanged(callback: (user: CloudUser | null) => void) {
  return onFirebaseAuthStateChanged(auth, callback);
}

export const loginWithEmail = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password);

export const createAccountWithEmail = (email: string, password: string) =>
  createUserWithEmailAndPassword(auth, email, password);

export const logout = () => signOut(auth);

/** Mirrors the dashboard's own mapping (maestro-nightly/dashboard/app/login/LoginClient.tsx). */
export function getCloudAuthErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case "auth/account-exists-with-different-credential":
      return "This email already has an account with another sign-in method.";
    case "auth/email-already-in-use":
      return "This email already has an account. Sign in instead of creating a new account.";
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return "The email or password is incorrect.";
    case "auth/weak-password":
      return "Choose a password with at least 6 characters.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/network-request-failed":
      // Firebase's generic "the request never completed". Its own wording is a
      // bare error code, which tells the user nothing they can act on.
      return "Could not reach Maestro Deck Cloud. Check your connection and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a moment and try again.";
    default:
      return error instanceof Error ? error.message : "Sign-in failed";
  }
}
