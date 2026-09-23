// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const storage = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: (k: string) => {
      storage.delete(k);
    },
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

vi.mock("@/lib/cloudAuth", () => ({
  fetchCloudBilling: vi.fn(),
  onCloudAuthStateChanged: vi.fn(),
}));

vi.mock("@/lib/cloudJobs", async () => {
  const actual = await vi.importActual<typeof import("./cloudJobs")>("./cloudJobs");
  return { ...actual, submitCloudJob: vi.fn(), fetchArtifactText: vi.fn() };
});

vi.mock("@/lib/cloudRun", async () => {
  const actual = await vi.importActual<typeof import("./cloudRun")>("./cloudRun");
  return { ...actual, watchCloudJob: vi.fn() };
});

const { fetchCloudBilling } = await import("@/lib/cloudAuth");
const { submitCloudJob, fetchArtifactText, CloudJobError } = await import("./cloudJobs");
const { watchCloudJob } = await import("./cloudRun");
const { startCloudRun, stopWatchingCloudRun } = await import("./cloudRunner");
const { useRunStore } = await import("@/stores/runStore");
const { useWorkspaceStore } = await import("@/stores/workspaceStore");
const { useCloudAuthStore } = await import("@/stores/cloudAuthStore");

import type { CloudWatchHandlers } from "./cloudRun";

const submit = vi.mocked(submitCloudJob);
const download = vi.mocked(fetchArtifactText);
const watch = vi.mocked(watchCloudJob);
const billing = vi.mocked(fetchCloudBilling);

const BILLING = {
  tier: "indie",
  runsRemaining: 41,
  runsToday: 1,
  dailyCap: 50,
  currentPack: null,
  expiresAt: null,
};

let handlers: CloudWatchHandlers;
let stopSpy: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.clearAllMocks();
  useRunStore.setState({ logs: [], steps: [], running: false, exitCode: null, cloud: null });
  useWorkspaceStore.setState({
    cloudApkPath: "/builds/app.apk",
    cloudIosAppPath: "/builds/App.zip",
  });
  useCloudAuthStore.setState({ user: { uid: "u1", email: "a@b.c" }, billing: null });
  billing.mockResolvedValue(BILLING);
  submit.mockResolvedValue({ jobId: "job-1", billed: true });
  stopSpy = vi.fn<() => void>();
  watch.mockImplementation((_id, h) => {
    handlers = h;
    return Object.assign(Promise.resolve(), { stop: stopSpy });
  });
});

const logText = () => useRunStore.getState().logs.map((l) => l.text);
const statuses = () => useRunStore.getState().steps.map((s) => s.status);

/** onFinished kicks off async work without returning its promise. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function initTwoSteps() {
  useRunStore.getState().initSteps([
    { index: 0, line: 3, endLine: 3, command: "launchApp", arg: "com.example" },
    { index: 1, line: 4, endLine: 4, command: "tapOn", arg: "Login" },
  ]);
}

describe("startCloudRun", () => {
  it("refuses to submit when no app was chosen for the fleet", async () => {
    useWorkspaceStore.setState({ cloudApkPath: null });

    const err = await startCloudRun("android", ["/f/login.yaml"]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CloudJobError);
    expect((err as InstanceType<typeof CloudJobError>).code).toBe("NO_APK");
    expect(submit).not.toHaveBeenCalled();
  });

  it("sends the iOS simulator build to iOS and the APK to both Android fleets", async () => {
    await startCloudRun("ios", ["/f/a.yaml"]);
    await startCloudRun("android_physical", ["/f/a.yaml"]);
    await startCloudRun("android", ["/f/a.yaml"]);

    expect(submit.mock.calls.map((c) => c[0].appPath)).toEqual([
      "/builds/App.zip",
      "/builds/app.apk",
      "/builds/app.apk",
    ]);
  });

  it("an iOS run without a simulator build is refused even when an APK is set", async () => {
    useWorkspaceStore.setState({ cloudIosAppPath: null });

    await expect(startCloudRun("ios", ["/f/a.yaml"])).rejects.toMatchObject({ code: "NO_APK" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("marks the run as a pending cloud job once the server accepted it", async () => {
    await startCloudRun("android", ["/f/a.yaml"]);

    const run = useRunStore.getState();
    expect(run.running).toBe(true);
    expect(run.cloud).toEqual({ jobId: "job-1", status: "pending" });
    expect(watch).toHaveBeenCalledWith("job-1", expect.anything());
  });

  it("leaves the run idle when the submission fails", async () => {
    submit.mockRejectedValue(new CloudJobError("QUOTA_EXCEEDED", "No runs left"));

    await expect(startCloudRun("android", ["/f/a.yaml"])).rejects.toThrow("No runs left");
    expect(useRunStore.getState().cloud).toBeNull();
    expect(watch).not.toHaveBeenCalled();
  });

  it("mirrors each status into the run so the toolbar can show it", async () => {
    await startCloudRun("android", ["/f/a.yaml"]);
    handlers.onStatus("running");
    expect(useRunStore.getState().cloud?.status).toBe("running");
  });

  it("tells a farm run it is waiting for a phone, not an emulator", async () => {
    await startCloudRun("android_physical", ["/f/a.yaml"]);
    handlers.onStatus("pending");
    expect(logText().at(-1)).toMatch(/phone/);

    await startCloudRun("android", ["/f/a.yaml"]);
    handlers.onStatus("pending");
    expect(logText().at(-1)).toMatch(/emulator/);
  });
});

describe("when the cloud run finishes", () => {
  it("replays the downloaded log through the step tracker", async () => {
    initTwoSteps();
    download.mockResolvedValue(
      [
        " > Flow login",
        `Launch app "com.example"... COMPLETED`,
        `Tap on "Login"... COMPLETED`,
      ].join("\n"),
    );
    await startCloudRun("android", ["/f/a.yaml"]);

    handlers.onFinished({
      job: { jobId: "job-1", status: "passed" },
      detail: {
        status: "success",
        summary: { total: 1, passed: 1, failed: 0 },
        logsUrl: "https://log",
      },
    });
    await flush();

    expect(download).toHaveBeenCalledWith("https://log");
    expect(statuses()).toEqual(["done", "done"]);
    expect(logText()).toContain(`Tap on "Login"... COMPLETED`);
  });

  it("stops the run with exit 0 on a pass and 1 on a failure", async () => {
    download.mockResolvedValue("");
    await startCloudRun("android", ["/f/a.yaml"]);
    handlers.onFinished({
      job: { jobId: "job-1", status: "passed" },
      detail: { status: "success", summary: null, logsUrl: null },
    });
    await flush();
    expect(useRunStore.getState()).toMatchObject({ running: false, exitCode: 0, cloud: null });

    await startCloudRun("android", ["/f/a.yaml"]);
    handlers.onFinished({
      job: { jobId: "job-1", status: "error", error: "Emulator never booted" },
      detail: { status: "error", summary: null, logsUrl: null },
    });
    await flush();
    expect(useRunStore.getState()).toMatchObject({ running: false, exitCode: 1 });
    expect(logText()).toContain("[cloud] Emulator never booted");
  });

  it("still reports the verdict when the log cannot be downloaded", async () => {
    download.mockRejectedValue(new Error("403"));
    await startCloudRun("android", ["/f/a.yaml"]);

    handlers.onFinished({
      job: { jobId: "job-1", status: "failed" },
      detail: {
        status: "failed",
        summary: { total: 2, passed: 1, failed: 1 },
        logsUrl: "https://log",
      },
    });
    await flush();

    expect(useRunStore.getState()).toMatchObject({ running: false, exitCode: 1 });
    expect(logText().some((l) => l.includes("could not be downloaded") && l.includes("403"))).toBe(
      true,
    );
  });

  it("does not leave a step spinning when the log stops mid-flow", async () => {
    initTwoSteps();
    download.mockResolvedValue(
      [" > Flow login", `Launch app "com.example"... COMPLETED`].join("\n"),
    );
    await startCloudRun("android", ["/f/a.yaml"]);

    handlers.onFinished({
      job: { jobId: "job-1", status: "failed" },
      detail: { status: "failed", summary: null, logsUrl: "https://log" },
    });
    await flush();

    expect(statuses()).toEqual(["done", "pending"]);
  });

  it("refreshes the balance, since the run spent one", async () => {
    await startCloudRun("android", ["/f/a.yaml"]);
    handlers.onFinished({
      job: { jobId: "job-1", status: "passed" },
      detail: { status: "success", summary: null, logsUrl: null },
    });
    await flush();

    expect(useCloudAuthStore.getState().billing).toEqual(BILLING);
  });

  it("ends the run without a verdict when the result cannot be read", async () => {
    await startCloudRun("android", ["/f/a.yaml"]);
    handlers.onError("HTTP 500");

    expect(useRunStore.getState()).toMatchObject({ running: false, exitCode: null, cloud: null });
    expect(logText().some((l) => l.includes("job-1"))).toBe(true);
  });

  it("ends the run without a verdict when watching gives up", async () => {
    await startCloudRun("android", ["/f/a.yaml"]);
    handlers.onGaveUp("job-1");

    expect(useRunStore.getState()).toMatchObject({ running: false, exitCode: null, cloud: null });
  });
});

describe("stopWatchingCloudRun", () => {
  it("detaches from the job and says it keeps running remotely", async () => {
    await startCloudRun("android", ["/f/a.yaml"]);

    stopWatchingCloudRun();

    expect(stopSpy).toHaveBeenCalledOnce();
    expect(useRunStore.getState()).toMatchObject({ running: false, cloud: null });
    expect(logText().at(-1)).toMatch(/job-1.*keeps running/);
  });

  it("no longer holds a watch once the run finished on its own", async () => {
    await startCloudRun("android", ["/f/a.yaml"]);
    handlers.onGaveUp("job-1");

    stopWatchingCloudRun();

    expect(stopSpy).not.toHaveBeenCalled();
  });
});
