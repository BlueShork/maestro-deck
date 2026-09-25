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
  // Tests run under the `node` environment, so React effects don't run and the
  // async status probe never resolves — the component renders its loading state.
  // That is exactly what we assert here: before the status is known, the card
  // shows a "checking" placeholder instead of a flash of false ✗ rows.
  it("always shows the card title", () => {
    const html = render();
    expect(html).toMatch(/Physical iPhone setup/i);
  });

  it("shows a loading placeholder until the status is known", () => {
    const html = render();
    expect(html).toMatch(/Checking your setup/i);
  });

  it("does not flash a false 'need 2.5.1' before the status loads", () => {
    const html = render();
    expect(html).not.toMatch(/need 2\.5\.1/i);
  });
});
