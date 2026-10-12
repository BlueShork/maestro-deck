import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BankGroup, BankImage } from "@/types/visualRegression";

const h = vi.hoisted(() => ({
  listBank: vi.fn(),
  loadBankImage: vi.fn(),
  deleteBankImage: vi.fn(),
  deleteBankDevice: vi.fn(),
}));
vi.mock("@/lib/ipc", () => ({ ipc: h }));

import { toast } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

import { ImageBankPage } from "./ImageBankPage";

const img = (name: string, w = 1080, hgt = 2400): BankImage => ({
  name,
  width: w,
  height: hgt,
  size_bytes: 2048,
  modified_ms: Date.UTC(2026, 9, 1),
});

const GROUPS: BankGroup[] = [
  { device_key: "Pixel_7_1080x2400", images: [img("home"), img("login"), img("cart")] },
  { device_key: "iPhone_16_Pro_1179x2556", images: [img("home", 1179, 2556)] },
];

/** Minimal IntersectionObserver: nothing is visible until `reveal` says so. */
class FakeIO {
  static instances: FakeIO[] = [];
  targets: Element[] = [];
  constructor(private cb: ConstructorParameters<typeof IntersectionObserver>[0]) {
    FakeIO.instances.push(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  disconnect() {
    this.targets = [];
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
  static reveal(match: (el: Element) => boolean) {
    for (const io of FakeIO.instances) {
      const hits = io.targets.filter(match);
      if (hits.length)
        io.cb(
          hits.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
          io as unknown as IntersectionObserver,
        );
    }
  }
}

function mount() {
  return render(
    <MemoryRouter initialEntries={["/image-bank"]}>
      <Routes>
        <Route path="/image-bank" element={<ImageBankPage />} />
        <Route path="/" element={<div>workspace</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const toastError = vi.spyOn(toast, "error");

beforeEach(() => {
  FakeIO.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIO);
  h.listBank.mockReset().mockResolvedValue(GROUPS);
  h.loadBankImage
    .mockReset()
    .mockImplementation(async (_w: string, key: string, name: string) => `data:${key}/${name}`);
  h.deleteBankImage.mockReset().mockResolvedValue(undefined);
  h.deleteBankDevice.mockReset().mockResolvedValue(undefined);
  toastError.mockClear();
  useWorkspaceStore.setState({ folderPath: "/ws" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("ImageBankPage", () => {
  it("needs a workspace", () => {
    useWorkspaceStore.setState({ folderPath: null });
    mount();
    expect(screen.getByText("No workspace open")).toBeTruthy();
    expect(h.listBank).not.toHaveBeenCalled();
  });

  it("explains how to seed an empty bank", async () => {
    h.listBank.mockResolvedValue([]);
    mount();
    expect(await screen.findByText("No baselines yet")).toBeTruthy();
  });

  it("lists devices with readable names and opens the first", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "Pixel 7" })).toBeTruthy();
    expect(screen.getByText("2 devices · 4 baselines")).toBeTruthy();
    expect(screen.getByText("1179×2556")).toBeTruthy();
    fireEvent.click(screen.getByText("iPhone 16 Pro"));
    expect(screen.getByRole("heading", { name: "iPhone 16 Pro" })).toBeTruthy();
  });

  it("loads a thumbnail only once it nears the viewport", async () => {
    mount();
    await screen.findByRole("heading", { name: "Pixel 7" });
    expect(h.loadBankImage).not.toHaveBeenCalled();
    act(() => FakeIO.reveal((el) => el.textContent?.includes("login") ?? false));
    await waitFor(() => expect(h.loadBankImage).toHaveBeenCalledTimes(1));
    expect(h.loadBankImage).toHaveBeenCalledWith("/ws", "Pixel_7_1080x2400", "login");
    expect(await screen.findByAltText("login")).toBeTruthy();
  });

  it("filters screenshots by name", async () => {
    mount();
    await screen.findByRole("heading", { name: "Pixel 7" });
    fireEvent.change(screen.getByLabelText("Search screenshots by name"), {
      target: { value: "log" },
    });
    expect(screen.getByRole("button", { name: "Open login" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open cart" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search screenshots by name"), {
      target: { value: "nothing" },
    });
    expect(screen.getByText("No results")).toBeTruthy();
  });

  it("deletes a screenshot only on the second click, then refreshes", async () => {
    mount();
    await screen.findByRole("heading", { name: "Pixel 7" });
    fireEvent.click(screen.getByRole("button", { name: "Delete cart" }));
    expect(h.deleteBankImage).not.toHaveBeenCalled();
    h.listBank.mockResolvedValue([
      { ...GROUPS[0], images: GROUPS[0].images.slice(0, 2) },
      GROUPS[1],
    ]);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Confirm delete cart" })),
    );
    expect(h.deleteBankImage).toHaveBeenCalledWith("/ws", "Pixel_7_1080x2400", "cart");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open cart" })).toBeNull());
  });

  it("reports a failed delete instead of failing silently", async () => {
    h.deleteBankImage.mockRejectedValue(new Error("EPERM"));
    mount();
    await screen.findByRole("heading", { name: "Pixel 7" });
    fireEvent.click(screen.getByRole("button", { name: "Delete cart" }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Confirm delete cart" })),
    );
    expect(toastError).toHaveBeenCalledWith("Delete failed", "EPERM");
  });

  it("deletes a whole device after confirmation", async () => {
    mount();
    await screen.findByRole("heading", { name: "Pixel 7" });
    fireEvent.click(screen.getByRole("button", { name: /Delete device/ }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /Confirm delete device/ })),
    );
    expect(h.deleteBankDevice).toHaveBeenCalledWith("/ws", "Pixel_7_1080x2400");
  });

  it("reports a bank that can't be read", async () => {
    h.listBank.mockRejectedValue(new Error("not a directory"));
    mount();
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not read the image bank", "not a directory"),
    );
  });

  it("opens a screenshot in the lightbox and navigates with the arrow keys", async () => {
    mount();
    await screen.findByRole("heading", { name: "Pixel 7" });
    fireEvent.click(screen.getByRole("button", { name: "Open login" }));
    expect(screen.getByText("2 / 3")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("3 / 3")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("1 / 3")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("3 / 3")).toBeTruthy();
  });

  it("Escape closes the lightbox, then clears the search, then leaves the page", async () => {
    mount();
    await screen.findByRole("heading", { name: "Pixel 7" });
    fireEvent.change(screen.getByLabelText("Search screenshots by name"), {
      target: { value: "home" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open home" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Esc close")).toBeNull();
    expect((screen.getByLabelText("Search screenshots by name") as HTMLInputElement).value).toBe(
      "home",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect((screen.getByLabelText("Search screenshots by name") as HTMLInputElement).value).toBe(
      "",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByText("workspace")).toBeTruthy();
  });
});
