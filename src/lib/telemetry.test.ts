// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flush, screenName, setScreen, track } from "@/lib/telemetry";
import { useTelemetryStore } from "@/stores/telemetryStore";

const fetchMock = vi.fn((_url: string, _init?: { body?: unknown }) =>
  Promise.resolve(new Response(null, { status: 200 })),
);

function sentBatch(): Array<{ event: string; properties: Record<string, unknown> }> {
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body)).batch;
}

beforeEach(() => {
  vi.stubEnv("DEV", false);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  useTelemetryStore.setState({ consent: null, decidedAt: null, installId: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("telemetry consent", () => {
  it("sends nothing before the user has answered", async () => {
    track("app_opened", {});
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing after the user declined", async () => {
    useTelemetryStore.getState().setConsent(false);
    track("app_opened", {});
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useTelemetryStore.getState().installId).toBeNull();
  });

  it("sends anonymous events once the user opted in", async () => {
    useTelemetryStore.getState().setConsent(true);
    const installId = useTelemetryStore.getState().installId;
    track("device_connected", { platform: "android", physical: true });
    await flush();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://eu.i.posthog.com/batch/");
    const [event] = sentBatch();
    expect(event?.event).toBe("device_connected");
    expect(event?.properties).toMatchObject({
      platform: "android",
      physical: true,
      distinct_id: installId,
      $process_person_profile: false,
    });
  });

  it("drops queued events when consent is withdrawn before they are sent", async () => {
    useTelemetryStore.getState().setConsent(true);
    track("app_opened", {});
    useTelemetryStore.getState().setConsent(false);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never reports from dev builds", async () => {
    vi.stubEnv("DEV", true);
    useTelemetryStore.getState().setConsent(true);
    track("app_opened", {});
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends screen views and tags later events with the current screen", async () => {
    useTelemetryStore.getState().setConsent(true);
    setScreen(screenName("/settings/ai"));
    track("app_opened", {});
    await flush();
    const [screen, opened] = sentBatch();
    expect(screen?.event).toBe("$screen");
    expect(screen?.properties.$screen_name).toBe("settings/ai");
    expect(opened?.properties.$screen_name).toBe("settings/ai");
  });

  it("names the root route the workspace", () => {
    expect(screenName("/")).toBe("workspace");
    expect(screenName("/image-bank/")).toBe("image-bank");
  });

  it("starts a fresh, unlinked install id after opting out and back in", () => {
    useTelemetryStore.getState().setConsent(true);
    const first = useTelemetryStore.getState().installId;
    useTelemetryStore.getState().setConsent(false);
    useTelemetryStore.getState().setConsent(true);
    expect(useTelemetryStore.getState().installId).not.toBe(first);
  });
});
