// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { getCloudIdToken } from "@/lib/cloudAuth";
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

async function authedJson<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const token = await getCloudIdToken();
  // Routed through Rust, not fetch: the API sets CORS headers on
  // /api/billing/me alone, so the webview's preflight for anything else comes
  // back bare and WebKit blocks the request before it is sent.
  const res = await ipc.cloudApiRequest(
    init?.method ?? "GET",
    path,
    token,
    init?.body === undefined ? undefined : JSON.stringify(init.body),
  );

  const parsed = parseJson(res.body);

  if (res.status >= 200 && res.status < 300) return parsed as T;

  if (res.status === 401) {
    throw new CloudJobError("UNAUTHENTICATED", "Your session expired — sign out and back in.");
  }

  // Every error route answers { error, message }; fall back to the status code
  // if one ever doesn't, rather than throwing while building the error.
  const body = parsed as { error?: string; message?: string } | null;
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

/** Takes the *job* id, despite the route being called `runs`: it looks up
 *  `jobs/{id}` for ownership and status, then reads `runs/run-{id}` itself for
 *  the counters (see the route's own comment in maestro-nightly). Passing
 *  `run-{jobId}` here 404s. */
export function fetchRunDetail(jobId: string): Promise<CloudRunDetail> {
  return authedJson<CloudRunDetail>(`/api/runs/${jobId}`);
}

/** Downloads an artifact from its signed URL. Through Rust as well: a GCS
 *  bucket sends no CORS headers by default, so the webview could not read this
 *  either. No auth header — the signature is the credential. */
export async function fetchArtifactText(url: string): Promise<string> {
  try {
    return await ipc.cloudDownloadText(url);
  } catch (err) {
    throw new CloudJobError(
      "REQUEST_FAILED",
      `Could not download the run log: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** The API always answers JSON, but an edge or proxy can return HTML on a bad
 *  day. Parsing must not throw here — the status still has to be reported. */
function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}
