// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage, ProviderEvent } from "@/types/chat";

vi.mock("@/lib/cloudAuth", () => ({
  CLOUD_DASHBOARD_URL: "https://dash.test",
  getCloudIdToken: vi.fn(async () => "tok"),
}));

const { getCloudIdToken } = await import("@/lib/cloudAuth");
const { MaestroDeckProvider } = await import("./MaestroDeckProvider");

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const MESSAGES: ChatMessage[] = [{ id: "1", role: "user", content: "Hi", createdAt: 0 }];

async function collect(signal = new AbortController().signal): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of new MaestroDeckProvider().stream({
    model: "billy",
    messages: MESSAGES,
    tools: [],
    signal,
  })) {
    out.push(e);
  }
  return out;
}

function sse(...payloads: unknown[]): Response {
  const text = payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("MaestroDeckProvider", () => {
  it("posts the conversation to the hosted agent with the user's token", async () => {
    fetchMock.mockResolvedValue(sse({ choices: [{ delta: {}, finish_reason: "stop" }] }));

    await collect();

    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      NonNullable<Parameters<typeof fetch>[1]>,
    ];
    expect(url).toBe("https://dash.test/api/assistant/agent");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    const body = JSON.parse(init.body as string) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages).toContainEqual(expect.objectContaining({ role: "user", content: "Hi" }));
  });

  it("streams the server's answer as provider events", async () => {
    fetchMock.mockResolvedValue(
      sse(
        { choices: [{ delta: { content: "Hel" } }] },
        { choices: [{ delta: { content: "lo" }, finish_reason: "stop" }] },
      ),
    );

    const events = await collect();

    expect(events).toEqual([
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "stop", reason: "end_turn" },
    ]);
  });

  it("asks the user to sign in again on 401", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    await expect(collect()).rejects.toThrow(/session expired/);
  });

  it("shows the server's own error when it gives one", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Daily assistant limit reached" }), { status: 429 }),
    );
    await expect(collect()).rejects.toThrow("Daily assistant limit reached");
  });

  it("falls back to the status when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(collect()).rejects.toThrow("HTTP 502");
  });

  it("replaces the webview's network error with an actionable one", async () => {
    const raw = new TypeError("Load failed");
    fetchMock.mockRejectedValue(raw);

    const err = (await collect().catch((e: unknown) => e)) as Error;

    expect(err.message).toMatch(/Check your connection/);
    expect(err.cause).toBe(raw);
  });

  it("lets a user-initiated abort through untouched", async () => {
    const abort = new AbortController();
    const raw = new DOMException("Aborted", "AbortError");
    fetchMock.mockImplementation(() => {
      abort.abort();
      return Promise.reject(raw);
    });

    await expect(collect(abort.signal)).rejects.toBe(raw);
  });

  it("does not call the server without a session", async () => {
    vi.mocked(getCloudIdToken).mockRejectedValueOnce(new Error("Not signed in"));
    await expect(collect()).rejects.toThrow("Not signed in");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
