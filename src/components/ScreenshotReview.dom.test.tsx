import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Comparison, RunReport } from "@/types/visualRegression";

const h = vi.hoisted(() => ({ resolveComparison: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: { resolveComparison: h.resolveComparison } }));

import { useReviewStore } from "@/stores/reviewStore";
import { toast } from "@/stores/toastStore";
import { useVisualRegressionStore } from "@/stores/visualRegressionStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

import { ScreenshotReview } from "./ScreenshotReview";

const comp = (
  name: string,
  status: Comparison["status"],
  over: Partial<Comparison> = {},
): Comparison => ({
  name,
  status,
  changed_ratio: 0.0123,
  bbox: [10, 20, 30, 40],
  bank_b64: `data:image/png;base64,BANK-${name}`,
  new_b64: `data:image/png;base64,NEW-${name}`,
  diff_b64: `data:image/png;base64,DIFF-${name}`,
  ...over,
});

const REPORT: RunReport = {
  run_id: "run-1",
  device_key: "pixel_7_1080x2400",
  comparisons: [
    comp("home", "match"),
    comp("login", "changed"),
    comp("cart", "seeded"),
    comp("checkout", "dimension_mismatch", { diff_b64: undefined, bbox: null }),
  ],
};

const toastError = vi.spyOn(toast, "error");
const image = (alt: string) => screen.getByAltText(alt).getAttribute("src");

beforeEach(() => {
  h.resolveComparison.mockReset().mockResolvedValue(undefined);
  toastError.mockClear();
  useWorkspaceStore.setState({ folderPath: "/ws" });
  useVisualRegressionStore.setState({ ignoreStatusBar: false });
  act(() => useReviewStore.getState().setReport(REPORT));
});
afterEach(() => {
  act(() => useReviewStore.getState().close());
  cleanup();
});

describe("reviewStore", () => {
  it("queues only the captures needing a decision, in report order", () => {
    expect(useReviewStore.getState()).toMatchObject({ queue: ["login", "checkout"], open: true });
  });

  it("stays closed for a clean report or no report", () => {
    useReviewStore.getState().setReport({ ...REPORT, comparisons: [comp("a", "match")] });
    expect(useReviewStore.getState().open).toBe(false);
    useReviewStore.getState().setReport(null);
    expect(useReviewStore.getState()).toMatchObject({ open: false, queue: [] });
  });

  it("next advances and closes after the last capture", () => {
    useReviewStore.getState().next();
    expect(useReviewStore.getState()).toMatchObject({ queue: ["checkout"], open: true });
    useReviewStore.getState().next();
    expect(useReviewStore.getState()).toMatchObject({ queue: [], open: false });
  });
});

describe("ScreenshotReview", () => {
  it("shows the first changed capture with its position and changed share", () => {
    render(<ScreenshotReview />);
    expect(screen.getByText("login")).toBeTruthy();
    expect(screen.getByText("1 of 2")).toBeTruthy();
    expect(screen.getByText(/1\.23% of pixels changed/)).toBeTruthy();
    expect(screen.getByText(/changed region 30×40 at \(10, 20\)/)).toBeTruthy();
    expect(image("bank reference")).toContain("BANK-login");
    expect(image("new capture")).toContain("DIFF-login");
  });

  it("toggles between the highlighted diff and the raw capture", () => {
    render(<ScreenshotReview />);
    fireEvent.click(screen.getByRole("button", { name: /Hide diff/ }));
    expect(image("new capture")).toContain("NEW-login");
    fireEvent.click(screen.getByRole("button", { name: /Show diff/ }));
    expect(image("new capture")).toContain("DIFF-login");
  });

  it("Replace baseline resolves the capture and moves on", async () => {
    render(<ScreenshotReview />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /Replace baseline/ })),
    );
    expect(h.resolveComparison).toHaveBeenCalledWith({
      workspace: "/ws",
      runId: "run-1",
      deviceKey: "pixel_7_1080x2400",
      name: "login",
      decision: "replace",
    });
    expect(screen.getByText("checkout")).toBeTruthy();
    expect(screen.getByText("2 of 2")).toBeTruthy();
    expect(screen.getByText(/Dimensions differ/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /diff/ })).toBeNull();
  });

  it("a double click decides once and never skips the next capture", async () => {
    let release!: () => void;
    h.resolveComparison.mockReturnValueOnce(new Promise<void>((r) => (release = r)));
    render(<ScreenshotReview />);
    const keep = screen.getByRole("button", { name: /Keep bank/ });
    fireEvent.click(keep);
    fireEvent.click(keep);
    await act(async () => release());
    expect(h.resolveComparison).toHaveBeenCalledTimes(1);
    expect(useReviewStore.getState().queue).toEqual(["checkout"]);
  });

  it("stays on the capture and reports when the bank can't be updated", async () => {
    h.resolveComparison.mockRejectedValue(new Error("disk full"));
    render(<ScreenshotReview />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Keep bank/ })));
    expect(toastError).toHaveBeenCalledWith("Could not update bank", "disk full");
    expect(screen.getByText("login")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Keep bank/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("closes after the last decision", async () => {
    render(<ScreenshotReview />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Keep bank/ })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Keep bank/ })));
    expect(screen.queryByText("Visual regression")).toBeNull();
    expect(useReviewStore.getState().open).toBe(false);
  });

  it("marks the ignored system bars when that option is on, except for web captures", () => {
    useVisualRegressionStore.setState({ ignoreStatusBar: true });
    const { unmount } = render(<ScreenshotReview />);
    expect(screen.getByText("system bars ignored")).toBeTruthy();
    expect(screen.getAllByText("ignored").length).toBeGreaterThan(0);
    unmount();
    act(() =>
      useReviewStore.getState().setReport({ ...REPORT, device_key: "web_chromium_1200x762" }),
    );
    render(<ScreenshotReview />);
    expect(screen.queryByText("system bars ignored")).toBeNull();
  });
});
