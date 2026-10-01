import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cloudAuth", () => ({
  CLOUD_DASHBOARD_URL: "https://dash.test",
  getCloudIdToken: vi.fn(async () => "id-token"),
}));

import { closeReasonMessage, farmApi, FarmApiError, farmDeviceLabel } from "@/lib/farmApi";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

const reply = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

describe("farmApi", () => {
  it("lists devices with the Firebase token", async () => {
    reply(200, { devices: [{ id: "nuc1-S1", state: "available" }] });
    const devices = await farmApi.listDevices();
    expect(devices[0].id).toBe("nuc1-S1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://dash.test/api/farm/devices");
    expect(init.headers.Authorization).toBe("Bearer id-token");
  });

  it("opens a session for a device", async () => {
    reply(200, { sessionId: "s1", gatewayUrl: "wss://g", token: "t", expiresAt: 1 });
    const open = await farmApi.open("nuc1-S1");
    expect(open.token).toBe("t");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ deviceId: "nuc1-S1" }),
    });
  });

  it("turns dashboard errors into readable messages", async () => {
    reply(402, { error: "no_minutes" });
    await expect(farmApi.open("d")).rejects.toMatchObject({
      code: "no_minutes",
      message: expect.stringMatching(/minutes/),
    });
    reply(409, { error: "session_exists", sessionId: "old" });
    const err = await farmApi.open("d").catch((e) => e);
    expect(err).toBeInstanceOf(FarmApiError);
    expect(err.sessionId).toBe("old");
    reply(500, {});
    await expect(farmApi.open("d")).rejects.toMatchObject({ code: "500" });
  });

  it("labels and close reasons", () => {
    expect(farmDeviceLabel({ id: "x", marketingName: null, model: "SM-S928B" } as never)).toBe(
      "SM-S928B",
    );
    expect(closeReasonMessage("idle")).toMatch(/inactivity/);
    expect(closeReasonMessage("weird")).toMatch(/ended/);
  });
});
