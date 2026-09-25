// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CloudUser } from "@/lib/cloudAuth";

vi.mock("@/lib/cloudAuth", () => ({
  fetchCloudBilling: vi.fn(),
  onCloudAuthStateChanged: vi.fn(),
}));

const { fetchCloudBilling, onCloudAuthStateChanged } = await import("@/lib/cloudAuth");
const { useCloudAuthStore, startCloudAuthListener } = await import("./cloudAuthStore");

const billing = vi.mocked(fetchCloudBilling);
const onAuth = vi.mocked(onCloudAuthStateChanged);

const USER: CloudUser = { uid: "u1", email: "me@example.com" };
const BILLING = {
  tier: "indie",
  runsRemaining: 12,
  runsToday: 3,
  dailyCap: 50,
  currentPack: null,
  expiresAt: null,
};

beforeEach(() => {
  billing.mockReset();
  useCloudAuthStore.setState({
    user: null,
    ready: false,
    billing: null,
    billingLoading: false,
    billingError: null,
  });
});

describe("refreshBilling", () => {
  it("does nothing while signed out", async () => {
    await useCloudAuthStore.getState().refreshBilling();
    expect(billing).not.toHaveBeenCalled();
    expect(useCloudAuthStore.getState().billingLoading).toBe(false);
  });

  it("stores the balance and clears the loading flag", async () => {
    useCloudAuthStore.setState({ user: USER });
    billing.mockResolvedValue(BILLING);

    const pending = useCloudAuthStore.getState().refreshBilling();
    expect(useCloudAuthStore.getState().billingLoading).toBe(true);
    await pending;

    expect(useCloudAuthStore.getState()).toMatchObject({
      billing: BILLING,
      billingLoading: false,
      billingError: null,
    });
  });

  it("keeps the failure message so the account page can offer a retry", async () => {
    useCloudAuthStore.setState({ user: USER });
    billing.mockRejectedValue(new Error("your session expired — sign out and back in"));

    await useCloudAuthStore.getState().refreshBilling();

    expect(useCloudAuthStore.getState()).toMatchObject({
      billingLoading: false,
      billingError: "your session expired — sign out and back in",
    });
  });

  it("clears an earlier error when a retry starts", async () => {
    useCloudAuthStore.setState({ user: USER, billingError: "old failure" });
    billing.mockResolvedValue(BILLING);

    await useCloudAuthStore.getState().refreshBilling();

    expect(useCloudAuthStore.getState().billingError).toBeNull();
  });
});

describe("startCloudAuthListener", () => {
  // The listener is a process-wide singleton, so these run against one
  // registration, in order.
  startCloudAuthListener();
  startCloudAuthListener();
  const callback = onAuth.mock.calls[0]?.[0];

  it("registers with Firebase only once however often it is started", () => {
    expect(onAuth).toHaveBeenCalledTimes(1);
  });

  it("marks auth as ready and loads the balance when a user signs in", async () => {
    billing.mockResolvedValue(BILLING);

    callback(USER);
    await vi.waitFor(() => expect(useCloudAuthStore.getState().billing).toEqual(BILLING));

    expect(useCloudAuthStore.getState()).toMatchObject({ user: USER, ready: true });
  });

  it("drops the previous account's balance on sign-out", () => {
    useCloudAuthStore.setState({ user: USER, billing: BILLING, billingError: "x" });

    callback(null);

    expect(useCloudAuthStore.getState()).toMatchObject({
      user: null,
      ready: true,
      billing: null,
      billingError: null,
    });
    expect(billing).not.toHaveBeenCalled();
  });
});
