// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: { cloudUploadFile: vi.fn(), cloudApiRequest: vi.fn(), cloudDownloadText: vi.fn() },
}));

vi.mock("@/lib/cloudAuth", () => ({
  getCloudIdToken: vi.fn(async () => "test-token"),
}));

const { ipc } = await import("@/lib/ipc");
const { submitCloudJob, CloudJobError, fetchJobStatus, fetchRunDetail, fetchArtifactText } =
  await import("./cloudJobs");

const uploadFile = vi.mocked(ipc.cloudUploadFile);
const apiRequest = vi.mocked(ipc.cloudApiRequest);
const downloadText = vi.mocked(ipc.cloudDownloadText);

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

/** What the Rust transport hands back: the raw status and body, unparsed. */
function jsonResponse(body: unknown, status = 200) {
  return { status, body: JSON.stringify(body) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

const INPUT = {
  platform: "android" as const,
  appPath: "/home/me/builds/app-debug.apk",
  yamlPaths: ["/home/me/flows/login.yaml"],
};

describe("submitCloudJob", () => {
  it("initialises with the file basenames, not their local paths", async () => {
    apiRequest
      .mockResolvedValueOnce(jsonResponse(INIT_OK))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await submitCloudJob(INPUT);

    const [method, path, token, body] = apiRequest.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe("/api/jobs/init");
    expect(token).toBe("test-token");
    expect(JSON.parse(body as string)).toEqual({
      platform: "android",
      apk: { name: "app-debug.apk" },
      yamls: [{ name: "login.yaml" }],
    });
  });

  it("uploads every file to the signed URL the server handed back", async () => {
    apiRequest
      .mockResolvedValueOnce(jsonResponse(INIT_OK))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await submitCloudJob(INPUT);

    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(uploadFile).toHaveBeenCalledWith(INIT_OK.apk.uploadUrl, INPUT.appPath);
    expect(uploadFile).toHaveBeenCalledWith(INIT_OK.yamls[0].uploadUrl, INPUT.yamlPaths[0]);
  });

  it("finalises with the GCS paths and returns the job id", async () => {
    apiRequest
      .mockResolvedValueOnce(jsonResponse(INIT_OK))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await submitCloudJob(INPUT);

    const [, path, , body] = apiRequest.mock.calls[1];
    expect(path).toBe("/api/jobs/finalize");
    expect(JSON.parse(body as string)).toEqual({
      jobId: "job-123",
      platform: "android",
      apkPath: INIT_OK.apk.gsPath,
      yamlPaths: [INIT_OK.yamls[0].gsPath],
    });
    expect(result.jobId).toBe("job-123");
  });

  it("never finalises when an upload fails", async () => {
    apiRequest.mockResolvedValueOnce(jsonResponse(INIT_OK));
    uploadFile.mockRejectedValueOnce(new Error("connection reset"));

    await expect(submitCloudJob(INPUT)).rejects.toThrow(CloudJobError);
    // A finalised job whose objects are missing burns a run and then fails on
    // the worker, so the second call must never happen.
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("names an exhausted quota rather than reporting a bare 402", async () => {
    apiRequest
      .mockResolvedValueOnce(jsonResponse(INIT_OK))
      .mockResolvedValueOnce(
        jsonResponse({ error: "QUOTA_EXCEEDED", message: "No runs left" }, 402),
      );

    const err = await submitCloudJob(INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudJobError);
    expect((err as InstanceType<typeof CloudJobError>).code).toBe("QUOTA_EXCEEDED");
  });

  it("carries the server's own message for a disabled service", async () => {
    apiRequest.mockResolvedValueOnce(
      jsonResponse({ error: "JOBS_DISABLED", message: "Job submission is unavailable." }, 503),
    );

    const err = await submitCloudJob(INPUT).catch((e: unknown) => e);
    expect((err as InstanceType<typeof CloudJobError>).code).toBe("JOBS_DISABLED");
    expect((err as Error).message).toContain("unavailable");
  });

  it("reports an expired session on 401", async () => {
    apiRequest.mockResolvedValueOnce(jsonResponse({}, 401));

    const err = await submitCloudJob(INPUT).catch((e: unknown) => e);
    expect((err as InstanceType<typeof CloudJobError>).code).toBe("UNAUTHENTICATED");
    expect((err as Error).message).toMatch(/expired/i);
  });

  it("stops before uploading when the server hands back no app upload URL", async () => {
    apiRequest.mockResolvedValueOnce(jsonResponse({ ...INIT_OK, apk: undefined }));

    await expect(submitCloudJob(INPUT)).rejects.toMatchObject({ code: "REQUEST_FAILED" });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("reports the status when an error page is not JSON", async () => {
    apiRequest.mockResolvedValueOnce({ status: 502, body: "<html>Bad Gateway</html>" });

    const err = await submitCloudJob(INPUT).catch((e: unknown) => e);
    expect((err as InstanceType<typeof CloudJobError>).code).toBe("REQUEST_FAILED");
    expect((err as Error).message).toContain("502");
  });

  it("uploads each flow to the URL issued for it, in order", async () => {
    apiRequest
      .mockResolvedValueOnce(
        jsonResponse({
          ...INIT_OK,
          yamls: [
            { name: "a.yaml", uploadUrl: "https://gcs.test/a", gsPath: "gs://b/a.yaml" },
            { name: "b.yaml", uploadUrl: "https://gcs.test/b", gsPath: "gs://b/b.yaml" },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await submitCloudJob({ ...INPUT, yamlPaths: ["/f/a.yaml", "/f/b.yaml"] });

    expect(uploadFile.mock.calls.slice(1)).toEqual([
      ["https://gcs.test/a", "/f/a.yaml"],
      ["https://gcs.test/b", "/f/b.yaml"],
    ]);
  });

  it("flags a failure that already cost the user a run", async () => {
    // Anything after finalize is billed: the caller needs to tell the user why
    // their balance moved.
    apiRequest
      .mockResolvedValueOnce(jsonResponse(INIT_OK))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await submitCloudJob(INPUT);
    expect(result.billed).toBe(true);
  });
});

describe("fetchJobStatus", () => {
  it("returns the normalised status for a job", async () => {
    apiRequest.mockResolvedValueOnce(jsonResponse({ jobId: "job-123", status: "running" }));

    await expect(fetchJobStatus("job-123")).resolves.toMatchObject({ status: "running" });
    expect(apiRequest.mock.calls[0][1]).toBe("/api/jobs/job-123/status");
  });
});

describe("fetchRunDetail", () => {
  it("looks the run up by its job id", async () => {
    apiRequest.mockResolvedValueOnce(
      jsonResponse({ status: "success", summary: null, logsUrl: null }),
    );

    await fetchRunDetail("job-123");

    expect(apiRequest.mock.calls[0][1]).toBe("/api/runs/job-123");
  });
});

describe("fetchArtifactText", () => {
  it("returns the downloaded text", async () => {
    downloadText.mockResolvedValueOnce("line 1\nline 2");
    await expect(fetchArtifactText("https://gcs.test/log")).resolves.toBe("line 1\nline 2");
  });

  it("wraps a failed download so the console can say what went missing", async () => {
    downloadText.mockRejectedValueOnce(new Error("403 Forbidden"));

    const err = await fetchArtifactText("https://gcs.test/log").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CloudJobError);
    expect((err as Error).message).toMatch(/run log.*403 Forbidden/);
  });
});
