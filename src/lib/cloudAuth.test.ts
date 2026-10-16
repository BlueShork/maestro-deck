// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Stands in for Firebase's Auth: only `currentUser` is read by the module. */
const fakeAuth = vi.hoisted(() => ({
  currentUser: null as { getIdToken: () => Promise<string> } | null,
}));

const fb = vi.hoisted(() => ({
  initializeApp: vi.fn(),
  listeners: [] as Array<(u: unknown) => void>,
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(async () => ({})),
  createUserWithEmailAndPassword: vi.fn(async () => ({})),
  signOut: vi.fn(async () => {}),
}));
fb.onAuthStateChanged.mockImplementation((_auth: unknown, cb: (u: unknown) => void) => {
  fb.listeners.push(cb);
  return () => {
    fb.listeners = fb.listeners.filter((l) => l !== cb);
  };
});

vi.mock("firebase/app", () => ({ initializeApp: fb.initializeApp, getApps: () => [] }));
vi.mock("firebase/auth", () => ({
  getAuth: () => fakeAuth,
  onAuthStateChanged: fb.onAuthStateChanged,
  signInWithEmailAndPassword: fb.signInWithEmailAndPassword,
  createUserWithEmailAndPassword: fb.createUserWithEmailAndPassword,
  signOut: fb.signOut,
}));

const {
  createAccountWithEmail,
  fetchCloudBilling,
  getCloudAuthErrorMessage,
  getCloudIdToken,
  isCloudSignedIn,
  liveMinutes,
  loginWithEmail,
  logout,
  onCloudAuthStateChanged,
  tierLabel,
} = await import("./cloudAuth");

const initCallsAtImport = fb.initializeApp.mock.calls.length;
const emitAuth = (user: unknown) => fb.listeners.forEach((l) => l(user));

const fetchMock = vi.fn();

beforeEach(() => {
  fakeAuth.currentUser = null;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function signIn(token = "id-token") {
  fakeAuth.currentUser = { getIdToken: vi.fn(async () => token) };
}

describe("tierLabel", () => {
  it("uses the dashboard's name for a known tier", () => {
    expect(tierLabel("free")).toBe("Free Tier");
  });

  it("capitalises a tier the app does not know yet instead of showing it raw", () => {
    expect(tierLabel("business")).toBe("Business");
  });
});

describe("getCloudIdToken", () => {
  it("refuses when nobody is signed in", async () => {
    await expect(getCloudIdToken()).rejects.toThrow("Not signed in");
  });

  it("returns the signed-in user's token", async () => {
    signIn("abc");
    await expect(getCloudIdToken()).resolves.toBe("abc");
  });

  it("translates a failed token refresh into something the user can act on", async () => {
    const raw = Object.assign(new Error("Firebase: Error (auth/network-request-failed)."), {
      code: "auth/network-request-failed",
    });
    fakeAuth.currentUser = { getIdToken: () => Promise.reject(raw) };

    const err = (await getCloudIdToken().catch((e: unknown) => e)) as Error;

    expect(err.message).toMatch(/Check your connection/);
    expect(err.cause).toBe(raw);
  });
});

describe("fetchCloudBilling", () => {
  it("authenticates with the user's ID token", async () => {
    signIn("tok-1");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tier: "pro" }), { status: 200 }));

    await expect(fetchCloudBilling()).resolves.toEqual({ tier: "pro" });

    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      NonNullable<Parameters<typeof fetch>[1]>,
    ];
    expect(url).toMatch(/\/api\/billing\/me$/);
    expect(init.headers).toEqual({ Authorization: "Bearer tok-1" });
  });

  it("names an expired session on 401", async () => {
    signIn();
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    await expect(fetchCloudBilling()).rejects.toThrow(/session expired/);
  });

  it("reports any other failure with its status", async () => {
    signIn();
    fetchMock.mockResolvedValue(new Response("<html>", { status: 502 }));
    await expect(fetchCloudBilling()).rejects.toThrow("HTTP 502");
  });

  it("does not call the API without a session", async () => {
    await expect(fetchCloudBilling()).rejects.toThrow("Not signed in");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getCloudAuthErrorMessage", () => {
  it("treats both wrong-credential codes as the same mistake", () => {
    const a = getCloudAuthErrorMessage({ code: "auth/invalid-credential" });
    const b = getCloudAuthErrorMessage({ code: "auth/invalid-login-credentials" });
    expect(a).toBe(b);
    expect(a).toMatch(/incorrect/);
  });

  it("points an existing email to sign-in rather than sign-up", () => {
    expect(getCloudAuthErrorMessage({ code: "auth/email-already-in-use" })).toMatch(/Sign in/);
  });

  it("falls back to the error's own message for an unmapped code", () => {
    const err = Object.assign(new Error("Something odd"), { code: "auth/internal-error" });
    expect(getCloudAuthErrorMessage(err)).toBe("Something odd");
  });

  it("has a generic message for a thrown non-Error", () => {
    expect(getCloudAuthErrorMessage("boom")).toBe("Sign-in failed");
    expect(getCloudAuthErrorMessage(null)).toBe("Sign-in failed");
  });
});

describe("liveMinutes", () => {
  const billing = (over: Record<string, unknown>) =>
    ({
      tier: "pro",
      runsRemaining: 10,
      runsToday: 0,
      dailyCap: 50,
      currentPack: { id: "pro", displayName: "Pro" },
      expiresAt: null,
      ...over,
    }) as Parameters<typeof liveMinutes>[0];

  it("reports what is left out of the pack's included minutes", () => {
    expect(liveMinutes(billing({ sessionMinutesRemaining: 180 }))).toEqual({
      remaining: 180,
      included: 240,
    });
  });

  it("is null when the plan has no live minutes", () => {
    expect(
      liveMinutes(billing({ tier: "free", currentPack: null, sessionMinutesRemaining: 0 })),
    ).toBeNull();
    // An older dashboard that doesn't send the field.
    expect(liveMinutes(billing({ tier: "free", currentPack: null }))).toBeNull();
  });

  it("still shows minutes left over from a pack that has ended", () => {
    expect(
      liveMinutes(billing({ tier: "free", currentPack: null, sessionMinutesRemaining: 25 })),
    ).toEqual({ remaining: 25, included: 25 });
  });

  it("never reports more included than remaining (top-ups stack)", () => {
    expect(liveMinutes(billing({ sessionMinutesRemaining: 300 }))).toEqual({
      remaining: 300,
      included: 300,
    });
  });
});

describe("lazy Firebase", () => {
  it("is not loaded by importing the module, and is initialised once", async () => {
    expect(initCallsAtImport).toBe(0);
    await getCloudIdToken().catch(() => {});
    await loginWithEmail("a@b.c", "pw");
    expect(fb.initializeApp).toHaveBeenCalledTimes(1);
  });

  it("delegates sign-in, sign-up and sign-out to Firebase", async () => {
    await loginWithEmail("a@b.c", "pw");
    await createAccountWithEmail("new@b.c", "secret");
    await logout();
    expect(fb.signInWithEmailAndPassword).toHaveBeenCalledWith(fakeAuth, "a@b.c", "pw");
    expect(fb.createUserWithEmailAndPassword).toHaveBeenCalledWith(fakeAuth, "new@b.c", "secret");
    expect(fb.signOut).toHaveBeenCalledWith(fakeAuth);
  });

  it("isCloudSignedIn follows the auth state", async () => {
    await getCloudIdToken().catch(() => {});
    emitAuth({ uid: "u", email: "a@b.c" });
    expect(isCloudSignedIn()).toBe(true);
    emitAuth(null);
    expect(isCloudSignedIn()).toBe(false);
  });

  it("onCloudAuthStateChanged reports changes once loaded, until unsubscribed", async () => {
    const cb = vi.fn();
    const unsubscribe = onCloudAuthStateChanged(cb);
    await vi.waitFor(() => expect(fb.listeners.length).toBeGreaterThan(1));
    emitAuth({ uid: "u", email: "a@b.c" });
    expect(cb).toHaveBeenCalledWith({ uid: "u", email: "a@b.c" });
    unsubscribe();
    emitAuth(null);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("unsubscribing before Firebase finished loading never subscribes", async () => {
    const before = fb.onAuthStateChanged.mock.calls.length;
    const cb = vi.fn();
    onCloudAuthStateChanged(cb)();
    await Promise.resolve();
    await Promise.resolve();
    emitAuth({ uid: "u", email: null });
    expect(cb).not.toHaveBeenCalled();
    expect(fb.onAuthStateChanged.mock.calls.length).toBe(before);
  });
});
