// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { CLOUD_DASHBOARD_URL, getCloudIdToken } from "@/lib/cloudAuth";
import { ipc } from "@/lib/ipc";

/**
 * Client for the job API the cloud dashboard already exposes
 * (maestro-nightly/dashboard/app/api/jobs). Submission is three steps, in this
 * order, and the order matters: `finalize` is what spends the user's run, so
 * nothing may call it until every object is actually in the bucket.
 *
 *   init(names)          → jobId + signed upload URLs (15 min TTL)
 *   PUT each file        → straight to GCS, done in Rust
 *   finalize(gs paths)   → job created, quota decremented, worker dispatched
 */

/** The only cloud platform wired up so far. The API also knows `android_physical`,
 *  `ios` and `web`; those tabs exist in the UI but submit nothing yet. */
export type CloudJobPlatform = "android";

export type CloudJobErrorCode =
  | "QUOTA_EXCEEDED"
  | "JOBS_DISABLED"
  | "UNAUTHENTICATED"
  | "UPLOAD_FAILED"
  | "NO_APK"
  | "REQUEST_FAILED";

/** Carries the server's own error code so callers can react to the case rather
 *  than pattern-match on a message. `billed` says whether the user's balance
 *  already moved — only true for failures after finalize succeeded. */
export class CloudJobError extends Error {
  constructor(
    readonly code: CloudJobErrorCode,
    message: string,
    readonly billed = false,
  ) {
    super(message);
    this.name = "CloudJobError";
  }
}

export interface SubmitCloudJobInput {
  platform: CloudJobPlatform;
  /** Absolute path to the .apk to install on the emulator. */
  apkPath: string;
  /** Absolute paths to the flow files to run. */
  yamlPaths: string[];
}

export interface SubmitCloudJobResult {
  jobId: string;
  /** Always true on success: finalize spent a run. Callers surface it so a
   *  later failure never looks like an unexplained decrement. */
  billed: boolean;
}

interface InitResponse {
  jobId: string;
  apk?: { uploadUrl: string; gsPath: string };
  yamls: { name: string; uploadUrl: string; gsPath: string }[];
}

/** Four raw statuses are all the runner and workers ever write
 *  (maestro-nightly/dashboard/lib/job-status.ts). */
export interface CloudJobStatus {
  jobId: string;
  status: string;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

async function authedJson<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = await getCloudIdToken();
  const res = await fetch(`${CLOUD_DASHBOARD_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  if (res.ok) return (await res.json()) as T;

  if (res.status === 401) {
    throw new CloudJobError("UNAUTHENTICATED", "Your session expired — sign out and back in.");
  }

  // Every error route answers { error, message }; fall back to the status code
  // if one ever doesn't, rather than throwing while building the error.
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    message?: string;
  } | null;
  const code: CloudJobErrorCode =
    body?.error === "QUOTA_EXCEEDED"
      ? "QUOTA_EXCEEDED"
      : body?.error === "JOBS_DISABLED"
        ? "JOBS_DISABLED"
        : "REQUEST_FAILED";
  throw new CloudJobError(code, body?.message ?? `Cloud request failed (HTTP ${res.status})`);
}

export async function submitCloudJob(input: SubmitCloudJobInput): Promise<SubmitCloudJobResult> {
  const init = await authedJson<InitResponse>("/api/jobs/init", {
    method: "POST",
    body: {
      platform: input.platform,
      apk: { name: basename(input.apkPath) },
      yamls: input.yamlPaths.map((p) => ({ name: basename(p) })),
    },
  });

  if (!init.apk) {
    throw new CloudJobError(
      "REQUEST_FAILED",
      "The cloud did not return an upload URL for the app.",
    );
  }

  // The server sanitises names, so it decides which uploadUrl belongs to which
  // flow. Pair them back up by position — init preserves the order it was given.
  const uploads: [string, string][] = [
    [init.apk.uploadUrl, input.apkPath],
    ...init.yamls.map((y, i): [string, string] => [y.uploadUrl, input.yamlPaths[i]]),
  ];

  for (const [url, path] of uploads) {
    try {
      await ipc.cloudUploadFile(url, path);
    } catch (err) {
      throw new CloudJobError(
        "UPLOAD_FAILED",
        `Uploading ${basename(path)} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await authedJson<unknown>("/api/jobs/finalize", {
    method: "POST",
    body: {
      jobId: init.jobId,
      platform: input.platform,
      apkPath: init.apk.gsPath,
      yamlPaths: init.yamls.map((y) => y.gsPath),
    },
  });

  return { jobId: init.jobId, billed: true };
}

export function fetchJobStatus(jobId: string): Promise<CloudJobStatus> {
  return authedJson<CloudJobStatus>(`/api/jobs/${jobId}/status`);
}

export interface CloudRunDetail {
  status: string;
  summary: { total: number; passed: number; failed: number } | null;
  /** Signed URL for maestro.log, null until the artifact exists. */
  logsUrl: string | null;
}

/** The run document lives under `run-{jobId}` — the job only carries a status,
 *  the counters and artifacts are on the run (maestro-nightly/dashboard). */
export function fetchRunDetail(jobId: string): Promise<CloudRunDetail> {
  return authedJson<CloudRunDetail>(`/api/runs/run-${jobId}`);
}

/** Downloads an artifact from its signed URL. No auth header: the signature is
 *  the credential, and adding one would invalidate it. */
export async function fetchArtifactText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new CloudJobError(
      "REQUEST_FAILED",
      `Could not download the run log (HTTP ${res.status})`,
    );
  }
  return res.text();
}
