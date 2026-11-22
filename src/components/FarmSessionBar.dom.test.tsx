import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({ ipc: { onFarmSession: vi.fn(async () => () => undefined) } }));
const openDialog = vi.fn(async (_opts: unknown) => null);
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (opts: unknown) => openDialog(opts) }));

import { FarmSessionBar } from "@/components/FarmSessionBar";
import { useFarmStore } from "@/stores/farmStore";

const phone = (id: string, state: "available" | "in_use" | "offline", name: string) => ({
  id,
  state,
  marketingName: name,
  model: name,
  manufacturer: "samsung",
  androidRelease: "15",
  sdk: 35,
  screen: null,
});

afterEach(cleanup);

beforeEach(() => {
  useFarmStore.setState({
    devices: [
      phone("a", "available", "Galaxy S24 Ultra"),
      phone("b", "in_use", "Pixel 8"),
      phone("c", "offline", "Moto"),
    ],
    session: null,
    refreshDevices: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
  });
});

describe("FarmSessionBar", () => {
  it("shows the phone, the minutes left and a release button", () => {
    const release = vi.fn(async () => undefined);
    useFarmStore.setState({
      session: {
        sessionId: "s1",
        deviceId: "a",
        label: "Galaxy S24 Ultra",
        gatewayUrl: "wss://g",
        startedAt: Date.now(),
        minutesRemaining: 30,
        maxEndsAt: Date.now() + 30 * 60_000,
        status: "active",
      },
      warnings: { idle: Date.now() + 60_000 },
      release,
    });
    render(<FarmSessionBar />);
    expect(screen.getByText(/Galaxy S24 Ultra/)).toBeTruthy();
    expect(screen.getByText(/min left/)).toBeTruthy();
    expect(screen.getByText(/closes soon without activity/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Release/ }));
    expect(release).toHaveBeenCalled();
  });

  it("renders nothing without a session", () => {
    useFarmStore.setState({ session: null });
    const { container } = render(<FarmSessionBar />);
    expect(container.textContent).toBe("");
  });
});

describe("FarmSessionBar warnings", () => {
  it("hides a warning whose deadline has passed", () => {
    useFarmStore.setState({
      session: {
        sessionId: "s1",
        deviceId: "a",
        label: "L",
        gatewayUrl: "wss://g",
        startedAt: Date.now(),
        minutesRemaining: 30,
        maxEndsAt: Date.now() + 60_000_00,
        status: "active",
      },
      warnings: { idle: Date.now() - 1000 },
      release: vi.fn(async () => undefined),
    });
    render(<FarmSessionBar />);
    expect(screen.queryByText(/closes soon without activity/)).toBeNull();
  });
});

describe("FarmSessionBar install", () => {
  const session = (platform?: "android" | "ios") => ({
    sessionId: "s1",
    deviceId: "a",
    label: "L",
    gatewayUrl: "wss://g",
    startedAt: Date.now(),
    minutesRemaining: 30,
    maxEndsAt: Date.now() + 30 * 60_000,
    status: "active" as const,
    ...(platform ? { platform } : {}),
  });

  it("offers an .apk on an Android phone", () => {
    useFarmStore.setState({ session: session(), installing: false });
    render(<FarmSessionBar />);
    fireEvent.click(screen.getByRole("button", { name: /Install APK/ }));
    expect(openDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ filters: [{ name: "Android app", extensions: ["apk"] }] }),
    );
  });

  it("offers an .ipa on a farm iPhone", () => {
    useFarmStore.setState({ session: session("ios"), installing: false });
    render(<FarmSessionBar />);
    fireEvent.click(screen.getByRole("button", { name: /Install IPA/ }));
    expect(openDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ filters: [{ name: "iOS app", extensions: ["ipa"] }] }),
    );
  });
});
