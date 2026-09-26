// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn();
const track = vi.fn();

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrl(url) }));
vi.mock("@/lib/telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/telemetry")>()),
  track: (...args: unknown[]) => track(...args),
}));

const { TelemetryConsentDialog } = await import("@/components/TelemetryConsentDialog");
const { useTelemetryStore } = await import("@/stores/telemetryStore");

beforeEach(() => {
  useTelemetryStore.setState({ consent: null, decidedAt: null, installId: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TelemetryConsentDialog", () => {
  it("is shown until the user answers", () => {
    render(<TelemetryConsentDialog />);
    expect(screen.getByText("Help us understand how Maestro Deck is used")).toBeTruthy();
    expect(screen.getByText("What we never collect")).toBeTruthy();
  });

  it("stays hidden once answered", () => {
    useTelemetryStore.setState({ consent: "denied" });
    render(<TelemetryConsentDialog />);
    expect(screen.queryByText("Help us understand how Maestro Deck is used")).toBeNull();
  });

  it("records a refusal without sending anything", () => {
    render(<TelemetryConsentDialog />);
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(useTelemetryStore.getState().consent).toBe("denied");
    expect(track).not.toHaveBeenCalled();
  });

  it("opts in and reports the launch", () => {
    render(<TelemetryConsentDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Share anonymous statistics" }));
    expect(useTelemetryStore.getState().consent).toBe("granted");
    expect(track).toHaveBeenCalledWith("app_opened", {});
  });

  it("treats closing the dialog as a refusal", () => {
    render(<TelemetryConsentDialog />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(useTelemetryStore.getState().consent).toBe("denied");
  });

  it("opens the privacy and cookie policies", () => {
    render(<TelemetryConsentDialog />);
    fireEvent.click(screen.getByRole("button", { name: "privacy policy" }));
    fireEvent.click(screen.getByRole("button", { name: "cookie policy" }));
    expect(openUrl).toHaveBeenCalledWith("https://www.maestrodeck.cloud/legal/confidentialite");
    expect(openUrl).toHaveBeenCalledWith("https://www.maestrodeck.cloud/legal/cookies");
  });
});
