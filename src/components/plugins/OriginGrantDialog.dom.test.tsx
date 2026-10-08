// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { askOriginGrant, useOriginGrantStore } from "@/stores/originGrantStore";

import { OriginGrantDialog } from "./OriginGrantDialog";

describe("OriginGrantDialog", () => {
  afterEach(() => {
    act(() => useOriginGrantStore.getState().answer(false));
    cleanup();
  });

  it("names the plugin and host, and Allow resolves true", async () => {
    render(<OriginGrantDialog />);
    let p!: Promise<boolean>;
    act(() => {
      p = askOriginGrant("GitLab", "https://git.acme.fr:8443");
    });
    expect(screen.getAllByText(/git\.acme\.fr:8443/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GitLab/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await expect(p).resolves.toBe(true);
  });

  it("closing the dialog refuses", async () => {
    render(<OriginGrantDialog />);
    let p!: Promise<boolean>;
    act(() => {
      p = askOriginGrant("GitLab", "https://git.acme.fr");
    });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await expect(p).resolves.toBe(false);
  });
});
