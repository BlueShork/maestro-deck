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

export type CloudUser = Pick<User, "uid" | "email">;

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
    default:
      return error instanceof Error ? error.message : "Sign-in failed";
  }
}
