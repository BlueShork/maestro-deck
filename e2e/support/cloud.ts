// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { Page, Route } from "@playwright/test";

import type { App } from "./app";
import { expect } from "./app";

export const DASHBOARD = "https://dashboard.maestrodeck.cloud";

export interface Billing {
  tier: string;
  runsRemaining: number;
  sessionMinutesRemaining?: number;
  runsToday: number;
  dailyCap: number;
  currentPack: { id: string; displayName: string } | null;
  expiresAt: string | null;
}

export const FREE_BILLING: Billing = {
  tier: "free",
  runsRemaining: 17,
  runsToday: 3,
  dailyCap: 10,
  currentPack: null,
  expiresAt: null,
};

export interface FakeCloud {
  hits: () => string[];
  lastAuth: () => string | null;
  setBilling: (b: Billing | { status: number }) => void;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
};

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

function idToken(uid: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64url({ alg: "RS256", typ: "JWT" }),
    b64url({
      iss: "https://securetoken.google.com/maestrodecknightly",
      aud: "maestrodecknightly",
      auth_time: now,
      user_id: uid,
      sub: uid,
      iat: now,
      exp: now + 3600,
      email,
      email_verified: false,
      firebase: { identities: { email: [email] }, sign_in_provider: "password" },
    }),
    "sig",
  ].join(".");
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    headers: CORS,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

const authError = (route: Route, message: string) =>
  json(route, { error: { code: 400, message, errors: [{ message, reason: "invalid" }] } }, 400);

export async function fakeCloud(
  page: Page,
  opts: {
    accounts?: Record<string, string>;
    billing?: Billing | { status: number };
    api?: Record<string, unknown | ((body: unknown, route: Route) => unknown)>;
  } = {},
): Promise<FakeCloud> {
  const accounts: Record<string, string> = {
    "me@example.com": "hunter22",
    ...(opts.accounts ?? {}),
  };
  let billing = opts.billing ?? FREE_BILLING;
  const hits: string[] = [];
  let lastAuth: string | null = null;
  const uidOf = (email: string) => `uid-${email.split("@")[0]}`;

  const session = (email: string) => ({
    kind: "identitytoolkit#VerifyPasswordResponse",
    localId: uidOf(email),
    email,
    displayName: "",
    registered: true,
    idToken: idToken(uidOf(email), email),
    refreshToken: `refresh-${email}`,
    expiresIn: "3600",
  });

  await page.route("https://identitytoolkit.googleapis.com/**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: CORS });
    const url = route.request().url();
    const body = (route.request().postDataJSON() ?? {}) as Record<string, string>;
    if (url.includes("accounts:signInWithPassword")) {
      if (accounts[body.email] !== body.password)
        return authError(route, "INVALID_LOGIN_CREDENTIALS");
      return json(route, session(body.email));
    }
    if (url.includes("accounts:signUp")) {
      if (body.email in accounts) return authError(route, "EMAIL_EXISTS");
      if ((body.password ?? "").length < 6)
        return authError(route, "WEAK_PASSWORD : Password should be at least 6 characters");
      accounts[body.email] = body.password;
      return json(route, { ...session(body.email), kind: "identitytoolkit#SignupNewUserResponse" });
    }
    if (url.includes("accounts:lookup")) {
      const token = body.idToken ?? "";
      const claims = JSON.parse(
        Buffer.from(token.split(".")[1] ?? "", "base64url").toString() || "{}",
      );
      return json(route, {
        kind: "identitytoolkit#GetAccountInfoResponse",
        users: [
          {
            localId: claims.user_id,
            email: claims.email,
            emailVerified: false,
            providerUserInfo: [
              {
                providerId: "password",
                email: claims.email,
                federatedId: claims.email,
                rawId: claims.email,
              },
            ],
            passwordUpdatedAt: 1,
            validSince: "1",
            lastLoginAt: "1",
            createdAt: "1",
          },
        ],
      });
    }
    return json(route, {});
  });

  await page.route("https://securetoken.googleapis.com/**", (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: CORS });
    const email =
      (route.request().postData() ?? "").match(/refresh-([^&]+)/)?.[1] ?? "me@example.com";
    const e = decodeURIComponent(email);
    return json(route, {
      access_token: idToken(uidOf(e), e),
      id_token: idToken(uidOf(e), e),
      expires_in: "3600",
      token_type: "Bearer",
      refresh_token: `refresh-${e}`,
      user_id: uidOf(e),
      project_id: "maestrodecknightly",
    });
  });

  await page.route(`${DASHBOARD}/api/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname;
    const key = `${req.method()} ${path}`;
    hits.push(key);
    lastAuth = req.headers()["authorization"] ?? null;
    if (key === "GET /api/billing/me") {
      return "status" in billing
        ? json(route, { error: "boom" }, billing.status)
        : json(route, billing);
    }
    const handler = opts.api?.[key];
    if (handler === undefined) return route.fallback();
    const out =
      typeof handler === "function"
        ? await (handler as (b: unknown, r: Route) => unknown)(req.postDataJSON(), route)
        : handler;
    if (out === undefined) return;
    return json(route, out);
  });

  return {
    hits: () => hits,
    lastAuth: () => lastAuth,
    setBilling: (b) => {
      billing = b;
    },
  };
}

export async function signIn(app: App, email = "me@example.com", password = "hunter22") {
  const { page } = app;
  await page.goto("/#/account");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("At least 6 characters").fill(password);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByText("Signed in to Maestro Deck Cloud")).toBeVisible();
  await page.goto("/#/");
}
