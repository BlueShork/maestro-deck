// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// This repo runs tests under the `node` environment (no jsdom), so we assert on
// the server-rendered markup rather than using Testing Library's DOM queries.
vi.mock("@/lib/ipc", () => ({
  ipc: {
    iosPhysicalSetupStatus: vi.fn().mockResolvedValue({
      xcodeInstalled: true,
      maestroVersion: "2.6.0",
      maestroIs251: false,
      maestroPatched: false,
    }),
  },
}));

import { PhysicalIosSetup } from "./PhysicalIosSetup";

const render = () =>
  renderToStaticMarkup(
    <PhysicalIosSetup
      bridgeInstalled={false}
      teamIdSet={false}
      onInstall={() => {}}
      installing={false}
    />,
  );

describe("PhysicalIosSetup", () => {
  it("shows maestro version mismatch explicitly", () => {
    const html = render();
    expect(html).toMatch(/need 2\.5\.1/i);
  });

  it("renders the Xcode row", () => {
    const html = render();
    expect(html).toMatch(/Xcode/i);
  });

  it("offers the Install action when the bridge is missing", () => {
    const html = render();
    expect(html).toMatch(/Install/i);
  });
});
