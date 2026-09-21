// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./cloudJobs", async () => {
  const actual = await vi.importActual<typeof import("./cloudJobs")>("./cloudJobs");
  return {
    ...actual,
    fetchJobStatus: vi.fn(),
    fetchRunDetail: vi.fn(),
  };
});

const { fetchJobStatus, fetchRunDetail } = await import("./cloudJobs");
const { watchCloudJob, CLOUD_POLL_MS, CLOUD_WATCH_CEILING_MS } = await import("./cloudRun");

const status = vi.mocked(fetchJobStatus);
const detail = vi.mocked(fetchRunDetail);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function handlers() {
  return {
    onStatus: vi.fn(),
    onFinished: vi.fn(),
    onGaveUp: vi.fn(),
    onError: vi.fn(),
  };
}

describe("watchCloudJob", () => {
  it("reports each status change once, not on every poll", async () => {
    status
      .mockResolvedValueOnce({ jobId: "j", status: "pending" })
      .mockResolvedValueOnce({ jobId: "j", status: "pending" })
      .mockResolvedValueOnce({ jobId: "j", status: "running" })
      .mockResolvedValue({ jobId: "j", status: "passed" });
    detail.mockResolvedValue({ status: "passed", summary: null, logsUrl: null });

    const h = handlers();
    const done = watchCloudJob("j", h);
    await vi.advanceTimersByTimeAsync(CLOUD_POLL_MS * 4);
    await done;

    expect(h.onStatus.mock.calls.map((c) => c[0])).toEqual(["pending", "running", "passed"]);
  });

  it("fetches the run detail once the job reaches a terminal status", async () => {
    status.mockResolvedValue({ jobId: "j", status: "failed" });
    detail.mockResolvedValue({
      status: "failed",
      summary: { total: 3, passed: 2, failed: 1 },
      logsUrl: "https://gcs.test/maestro.log?sig=1",
    });

    const h = handlers();
    const done = watchCloudJob("j", h);
    await vi.advanceTimersByTimeAsync(CLOUD_POLL_MS);
    await done;

    expect(detail).toHaveBeenCalledWith("j");
    expect(h.onFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", summary: { total: 3, passed: 2, failed: 1 } }),
    );
  });

  it("keeps watching while the job is still pending", async () => {
    status.mockResolvedValue({ jobId: "j", status: "running" });

    const h = handlers();
    void watchCloudJob("j", h);
    await vi.advanceTimersByTimeAsync(CLOUD_POLL_MS * 3);

    expect(h.onFinished).not.toHaveBeenCalled();
    expect(status.mock.calls.length).toBeGreaterThan(2);
  });

  it("gives up at the ceiling instead of polling forever", async () => {
    status.mockResolvedValue({ jobId: "j", status: "running" });

    const h = handlers();
    const done = watchCloudJob("j", h);
    await vi.advanceTimersByTimeAsync(CLOUD_WATCH_CEILING_MS + CLOUD_POLL_MS);
    await done;

    expect(h.onGaveUp).toHaveBeenCalledWith("j");
    expect(h.onFinished).not.toHaveBeenCalled();
  });

  it("stops polling when the caller detaches", async () => {
    status.mockResolvedValue({ jobId: "j", status: "running" });

    const h = handlers();
    const done = watchCloudJob("j", h);
    await vi.advanceTimersByTimeAsync(CLOUD_POLL_MS);
    const callsAtDetach = status.mock.calls.length;

    done.stop();
    await vi.advanceTimersByTimeAsync(CLOUD_POLL_MS * 5);

    expect(status.mock.calls.length).toBe(callsAtDetach);
    // Detaching is not a failure: the job keeps running in the cloud.
    expect(h.onGaveUp).not.toHaveBeenCalled();
  });

  it("reports a terminal job whose detail cannot be read, instead of looping", async () => {
    // The run is over either way. Swallowing the error here left the console
    // frozen on "running" until the 20 minute ceiling.
    status.mockResolvedValue({ jobId: "j", status: "failed" });
    detail.mockRejectedValue(new Error("not found"));

    const h = handlers();
    const done = watchCloudJob("j", h);
    await vi.advanceTimersByTimeAsync(CLOUD_POLL_MS * 2);
    await done;

    expect(h.onError).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(detail).toHaveBeenCalledTimes(1);
  });

  it("survives a transient status error rather than dropping the run", async () => {
    status
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValue({ jobId: "j", status: "passed" });
    detail.mockResolvedValue({ status: "passed", summary: null, logsUrl: null });

    const h = handlers();
    const done = watchCloudJob("j", h);
    await vi.advanceTimersByTimeAsync(CLOUD_POLL_MS * 3);
    await done;

    expect(h.onFinished).toHaveBeenCalled();
  });
});
