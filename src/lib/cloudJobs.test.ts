// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: { cloudUploadFile: vi.fn() },
}));

vi.mock("@/lib/cloudAuth", () => ({
  CLOUD_DASHBOARD_URL: "https://dashboard.test",
  getCloudIdToken: vi.fn(async () => "test-token"),
}));

const { ipc } = await import("@/lib/ipc");
const { submitCloudJob, CloudJobError, fetchJobStatus } = await import("./cloudJobs");

const uploadFile = vi.mocked(ipc.cloudUploadFile);

/** Shapes the real routes return (maestro-nightly/dashboard/app/api/jobs). */
const INIT_OK = {
  jobId: "job-123",
  apk: { uploadUrl: "https://gcs.test/apk?sig=1", gsPath: "gs://bucket/uid/job-123/app.apk" },
  yamls: [
    {
      name: "login.yaml",
      uploadUrl: "https://gcs.test/login?sig=1",
      gsPath: "gs://bucket/uid/job-123/tests/login.yaml",
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

const INPUT = {
  platform: "android" as const,
  apkPath: "/home/me/builds/app-debug.apk",
  yamlPaths: ["/home/me/flows/login.yaml"],
};

describe("submitCloudJob", () => {
  it("initialises with the file basenames, not their local paths", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(INIT_OK))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await submitCloudJob(INPUT);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://dashboard.test/api/jobs/init");
    expect(JSON.parse(init.body)).toEqual({
      platform: "android",
      apk: { name: "app-debug.apk" },
      yamls: [{ name: "login.yaml" }],
    });
    expect(init.headers.Authorization).toBe("Bearer test-token");
  });

  it("uploads every file to the signed URL the server handed back", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(INIT_OK))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await submitCloudJob(INPUT);

    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(uploadFile).toHaveBeenCalledWith(INIT_OK.apk.uploadUrl, INPUT.apkPath);
    expect(uploadFile).toHaveBeenCalledWith(INIT_OK.yamls[0].uploadUrl, INPUT.yamlPaths[0]);
  });

  it("finalises with the GCS paths and returns the job id", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(INIT_OK))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await submitCloudJob(INPUT);

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://dashboard.test/api/jobs/finalize");
    expect(JSON.parse(init.body)).toEqual({
      jobId: "job-123",
      platform: "android",
      apkPath: INIT_OK.apk.gsPath,
      yamlPaths: [INIT_OK.yamls[0].gsPath],
    });
    expect(result.jobId).toBe("job-123");
  });

  it("never finalises when an upload fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(INIT_OK));
    uploadFile.mockRejectedValueOnce(new Error("connection reset"));

    await expect(submitCloudJob(INPUT)).rejects.toThrow(CloudJobError);
    // A finalised job whose objects are missing burns a run and then fails on
    // the worker, so the second call must never happen.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("names an exhausted quota rather than reporting a bare 402", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(INIT_OK))
      .mockResolvedValueOnce(
        jsonResponse({ error: "QUOTA_EXCEEDED", message: "No runs left" }, 402),
      );

    const err = await submitCloudJob(INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudJobError);
    expect((err as InstanceType<typeof CloudJobError>).code).toBe("QUOTA_EXCEEDED");
  });

  it("carries the server's own message for a disabled service", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "JOBS_DISABLED", message: "Job submission is unavailable." }, 503),
    );

    const err = await submitCloudJob(INPUT).catch((e: unknown) => e);
    expect((err as InstanceType<typeof CloudJobError>).code).toBe("JOBS_DISABLED");
    expect((err as Error).message).toContain("unavailable");
  });

  it("reports an expired session on 401", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));

    const err = await submitCloudJob(INPUT).catch((e: unknown) => e);
    expect((err as InstanceType<typeof CloudJobError>).code).toBe("UNAUTHENTICATED");
    expect((err as Error).message).toMatch(/expired/i);
  });

  it("flags a failure that already cost the user a run", async () => {
    // Anything after finalize is billed: the caller needs to tell the user why
    // their balance moved.
    fetchMock
      .mockResolvedValueOnce(jsonResponse(INIT_OK))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await submitCloudJob(INPUT);
    expect(result.billed).toBe(true);
  });
});

describe("fetchJobStatus", () => {
  it("returns the normalised status for a job", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ jobId: "job-123", status: "running" }));

    await expect(fetchJobStatus("job-123")).resolves.toMatchObject({ status: "running" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://dashboard.test/api/jobs/job-123/status");
  });
});
