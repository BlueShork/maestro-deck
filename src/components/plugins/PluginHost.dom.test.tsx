// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({ ipc: {} }));

import type { PluginManifest } from "@/lib/plugins/types";

import { PluginHost } from "./PluginHost";

const manifest: PluginManifest = {
  id: "jira",
  name: "Jira",
  version: "1.0.0",
  minAppVersion: "1.1.0",
  entry: "index.html",
  permissions: { http: [], open: [], secrets: false },
};

afterEach(cleanup);

async function ask(frame: HTMLIFrameElement, source: Window | null) {
  const win = frame.contentWindow!;
  const post = vi.spyOn(win, "postMessage");
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "md-rpc", id: "1", method: "app.info" },
        source,
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
  });
  return post.mock.calls.filter(([msg]) => (msg as { type?: string }).type === "md-rpc-result");
}

describe("PluginHost", () => {
  it("answers its own frame and ignores other windows", async () => {
    render(<PluginHost manifest={manifest} />);
    const frame = screen.getByTitle("Jira") as HTMLIFrameElement;
    fireEvent.load(frame);
    expect(await ask(frame, window)).toHaveLength(0);
    expect(await ask(frame, frame.contentWindow)).toHaveLength(1);
  });

  it("stops the plugin when its frame loads a second document", async () => {
    render(<PluginHost manifest={manifest} />);
    const frame = screen.getByTitle("Jira") as HTMLIFrameElement;
    fireEvent.load(frame);
    fireEvent.load(frame);
    expect(screen.queryByTitle("Jira")).toBeNull();
    expect(screen.getByText(/navigated away/i)).toBeTruthy();
  });
});
