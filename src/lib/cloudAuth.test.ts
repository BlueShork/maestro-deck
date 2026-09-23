// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Stands in for Firebase's Auth: only `currentUser` is read by the module. */
const fakeAuth = vi.hoisted(() => ({
  currentUser: null as { getIdToken: () => Promise<string> } | null,
}));

vi.mock("firebase/app", () => ({ initializeApp: vi.fn(), getApps: () => [] }));
vi.mock("firebase/auth", () => ({
  getAuth: () => fakeAuth,
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));

const { fetchCloudBilling, getCloudAuthErrorMessage, getCloudIdToken, tierLabel } =
  await import("./cloudAuth");

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
