import { expect, test, type App } from "./support/app";
import { fakeCloud, FREE_BILLING, signIn } from "./support/cloud";
import { PASSING_RUN, PIXEL, WS, withWorkspace } from "./support/data";
import type { CloudReply } from "./support/tauriMock";

const LOGIN = `${WS}/auth/login.yaml`;
const APK = "/Users/me/builds/app-debug.apk";

const opened = {
  ...withWorkspace,
  storage: {
    ...withWorkspace.storage,
    "maestro-deck.workspace": JSON.stringify({
      state: { folderPath: WS, expanded: {}, lastOpenFile: LOGIN },
      version: 0,
    }),
  },
};

const ok = (body: unknown): CloudReply => ({ status: 200, body: JSON.stringify(body) });

const INIT = ok({
  jobId: "job-42",
  apk: { uploadUrl: "https://storage.example/apk?sig", gsPath: "gs://b/job-42/app.apk" },
  yamls: [
    {
      name: "login.yaml",
      uploadUrl: "https://storage.example/y0?sig",
      gsPath: "gs://b/job-42/login.yaml",
    },
  ],
});

const picker = (app: App) => app.page.getByRole("dialog");

async function openPicker(app: App) {
  await app.page.getByRole("banner").getByRole("button", { name: "Choose a device" }).click();
  await expect(picker(app)).toBeVisible();
}

async function targetEmulator(app: App, apk = APK) {
  await openPicker(app);
  await app.answerDialogs("open", apk);
  await picker(app)
    .getByRole("button", { name: /Android emulator.*Run here/ })
    .click();
}

test.describe("cloud runs", () => {
  test("runs the open flow on a hosted emulator, from upload to the verdict", async ({
    app,
    page,
  }) => {
    const cloud = await fakeCloud(page);
    await app.launch({
      ...opened,
      cloudApi: {
        "POST /api/jobs/init": INIT,
        "POST /api/jobs/finalize": ok({ ok: true }),
        "GET /api/jobs/job-42/status": [
          ok({ jobId: "job-42", status: "running" }),
          ok({ jobId: "job-42", status: "passed", reportUrl: "https://dash/runs/job-42" }),
        ],
        "GET /api/jobs/job-42/live": ok({
          frame:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          updatedAt: null,
        }),
        "GET /api/runs/job-42": ok({
          status: "passed",
          summary: { total: 1, passed: 1, failed: 0 },
          logsUrl: "https://storage.example/logs?sig",
        }),
      },
      responses: { cloud_download_text: PASSING_RUN.join("\n") },
    });
    await signIn(app);
    await expect(page.locator(".cm-content")).toContainText("Welcome");
    await targetEmulator(app);
    await expect(page.getByRole("button", { name: "app-debug.apk Change" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run all" })).toBeDisabled();
    await page.getByRole("button", { name: "Run in cloud" }).click();
    await page.getByRole("button", { name: "Technical" }).click();

    const uploads = await app.waitForCall("cloud_upload_file", 2);
    expect(uploads.map((c) => c.args)).toEqual([
      { uploadUrl: "https://storage.example/apk?sig", path: APK },
      { uploadUrl: "https://storage.example/y0?sig", path: LOGIN },
    ]);
    const init = (await app.calls("cloud_api_request")).find((c) =>
      JSON.stringify(c.args).includes("/api/jobs/init"),
    )!;
    expect(JSON.parse((init.args as { body: string }).body)).toEqual({
      platform: "android",
      apk: { name: "app-debug.apk" },
      yamls: [{ name: "login.yaml" }],
    });
    await expect(page.getByText(/job job-42 queued/)).toBeVisible();
    await expect(page.locator("img[src^='data:image/png']")).toBeVisible();

    await expect(page.getByText("[cloud] passed — 1/1 passed")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("[cloud] full report: https://dash/runs/job-42")).toBeVisible();
    await page.getByRole("button", { name: "Simple" }).click();
    await expect(page.getByText("Test passed")).toBeVisible();
    await expect(
      page
        .locator("section")
        .filter({ hasText: "Console" })
        .last()
        .locator("div.border-l-2 .step-pip-done"),
    ).toHaveCount(4);
    await expect
      .poll(() => cloud.hits().filter((h) => h === "GET /api/billing/me").length)
      .toBeGreaterThan(1);
  });

  test("an .aab is refused before anything is uploaded", async ({ app, page }) => {
    await fakeCloud(page);
    await app.launch(opened);
    await signIn(app);
    await targetEmulator(app, "/Users/me/builds/app.aab");
    await expect(
      page.getByText("The cloud installs .apk files only, not .aab bundles."),
    ).toBeVisible();
    await expect(picker(app).getByText("No .apk chosen").first()).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Run in cloud" }),
    ).toHaveCount(0);
    expect(await app.calls("cloud_upload_file")).toHaveLength(0);
  });

  test("an exhausted quota is reported and nothing runs", async ({ app, page }) => {
    await fakeCloud(page);
    await app.launch({
      ...opened,
      cloudApi: {
        "POST /api/jobs/init": {
          status: 402,
          body: JSON.stringify({
            error: "QUOTA_EXCEEDED",
            message: "You have no cloud runs left.",
          }),
        },
      },
    });
    await signIn(app);
    await expect(page.locator(".cm-content")).toContainText("Welcome");
    await targetEmulator(app);
    await page.getByRole("button", { name: "Run in cloud" }).click();
    await expect(page.getByText("You have no cloud runs left.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Run in cloud" })).toBeEnabled();
    expect(await app.calls("cloud_upload_file")).toHaveLength(0);
  });

  test("a failed job reports its error and fails the run", async ({ app, page }) => {
    await fakeCloud(page);
    await app.launch({
      ...opened,
      cloudApi: {
        "POST /api/jobs/init": INIT,
        "POST /api/jobs/finalize": ok({ ok: true }),
        "GET /api/jobs/job-42/status": ok({
          jobId: "job-42",
          status: "error",
          error: "The app crashed on launch",
        }),
        "GET /api/runs/job-42": ok({ status: "error", summary: null, logsUrl: null }),
      },
    });
    await signIn(app);
    await expect(page.locator(".cm-content")).toContainText("Welcome");
    await targetEmulator(app);
    await page.getByRole("button", { name: "Run in cloud" }).click();
    await page.getByRole("button", { name: "Technical" }).click();
    await expect(page.getByText("[cloud] The app crashed on launch")).toBeVisible();
    await expect(page.getByText("[cloud] the run produced no log artifact")).toBeVisible();
    await page.getByRole("button", { name: "Simple" }).click();
    await expect(page.getByText("Test failed")).toBeVisible();
  });

  test("Stop stops watching, and says the job keeps running", async ({ app, page }) => {
    await fakeCloud(page);
    await app.launch({
      ...opened,
      cloudApi: {
        "POST /api/jobs/init": INIT,
        "POST /api/jobs/finalize": ok({ ok: true }),
        "GET /api/jobs/job-42/status": ok({ jobId: "job-42", status: "pending" }),
      },
    });
    await signIn(app);
    await expect(page.locator(".cm-content")).toContainText("Welcome");
    await targetEmulator(app);
    await page.getByRole("button", { name: "Run in cloud" }).click();
    await page.getByRole("button", { name: "Technical" }).click();
    await expect(page.getByText("[cloud] waiting for a free emulator…")).toBeVisible();
    await page.getByRole("button", { name: "Stop watching" }).click();
    await expect(
      page.getByText("[cloud] stopped watching job job-42 — it keeps running in the cloud"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Run in cloud" })).toBeEnabled();
    expect(await app.calls("stop_flow")).toHaveLength(0);
  });

  test("clearing the target sends runs back to the local device", async ({ app, page }) => {
    await fakeCloud(page);
    await app.launch({ ...opened, devices: [PIXEL] });
    await signIn(app);
    await expect(page.locator(".cm-content")).toContainText("Welcome");
    await targetEmulator(app);
    await page.getByRole("button", { name: "Clear target" }).click();
    await page.getByRole("button", { name: /^Run$/ }).click();
    await app.waitForCall("run_flow");
    expect(await app.calls("cloud_api_request")).toHaveLength(0);
  });

  test("signed out, the picker offers to sign in instead of cloud targets", async ({
    app,
    page,
  }) => {
    await app.launch(opened);
    await openPicker(app);
    await picker(app)
      .getByRole("button", { name: /Sign in/ })
      .first()
      .click();
    await expect(page).toHaveURL(/#\/account$/);
  });
});

const S24 = {
  id: "farm-s24",
  manufacturer: "samsung",
  model: "SM-S928B",
  marketingName: "Galaxy S24 Ultra",
  androidRelease: "15",
  sdk: 35,
  screen: { width: 1440, height: 3120, density: 600 },
  state: "available",
};
const PIXEL_FARM = {
  ...S24,
  id: "farm-p8",
  model: "Pixel 8",
  marketingName: "Pixel 8",
  state: "in_use",
};

const FARM_DEVICE = {
  ...PIXEL,
  serial: "farm:farm-s24",
  model: "Galaxy S24 Ultra",
  physical: true,
};

async function farmCloud(
  app: App,
  open: unknown = { sessionId: "s-1", gatewayUrl: "wss://gw/s-1", token: "t0k", expiresAt: 0 },
) {
  return fakeCloud(app.page, {
    billing: { ...FREE_BILLING, tier: "indie", sessionMinutesRemaining: 60 },
    api: {
      "GET /api/farm/devices": { devices: [S24, PIXEL_FARM] },
      "POST /api/farm/sessions": open,
      "DELETE /api/farm/sessions/s-1": { ok: true },
    },
  });
}

async function holdS24(app: App) {
  await openPicker(app);
  await picker(app)
    .getByRole("button", { name: /Galaxy S24 Ultra.*Connect/ })
    .click();
  await expect(app.page.getByText("Farm phone connected")).toBeVisible();
}

test.describe("device farm", () => {
  test("lists farm phones and opens a live session on one", async ({ app, page }) => {
    const cloud = await farmCloud(app);
    await app.launch({ responses: { connect_farm_device: FARM_DEVICE } });
    await signIn(app);
    await openPicker(app);
    await expect(picker(app).getByText("Device farm · real phones, live")).toBeVisible();
    await expect(picker(app).getByRole("button", { name: /Pixel 8.*In use/ })).toBeDisabled();

    await picker(app)
      .getByRole("button", { name: /Galaxy S24 Ultra.*Connect/ })
      .click();
    const [connect] = await app.waitForCall("connect_farm_device");
    expect(connect.args).toEqual({ gatewayUrl: "wss://gw/s-1", token: "t0k" });
    expect(cloud.hits()).toContain("POST /api/farm/sessions");
    await expect(page.getByText("Farm phone connected")).toBeVisible();

    await page.keyboard.press("Escape");
    await app.emit("farm://session", {
      type: "hello",
      hello: {
        deviceId: "farm-s24",
        model: "SM-S928B",
        androidRelease: "15",
        videoWidth: 720,
        videoHeight: 1560,
        minutesRemaining: 42,
        maxEndsAt: Date.now() + 42 * 60_000,
      },
    });
    await expect(page.getByText(/4[12] min left/)).toBeVisible();
  });

  test("Release ends the session on the dashboard and frees the device", async ({ app, page }) => {
    const cloud = await farmCloud(app);
    await app.launch({ responses: { connect_farm_device: FARM_DEVICE } });
    await signIn(app);
    await holdS24(app);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Release" }).first().click();
    await app.waitForCall("disconnect_device");
    await expect.poll(() => cloud.hits()).toContain("DELETE /api/farm/sessions/s-1");
    await expect(page.getByRole("button", { name: "Release" })).toHaveCount(0);
  });

  test("a phone taken in the meantime is explained", async ({ app, page }) => {
    await farmCloud(app, (_: unknown, route: import("@playwright/test").Route) =>
      route
        .fulfill({
          status: 409,
          headers: { "access-control-allow-origin": "*" },
          contentType: "application/json",
          body: JSON.stringify({ error: "device_busy" }),
        })
        .then(() => undefined),
    );
    await app.launch();
    await signIn(app);
    await openPicker(app);
    await picker(app)
      .getByRole("button", { name: /Galaxy S24 Ultra.*Connect/ })
      .click();
    await expect(page.getByText("Someone just took this phone. Pick another one.")).toBeVisible();
    expect(await app.calls("connect_farm_device")).toHaveLength(0);
  });

  test("the farm's warnings and its closing are shown", async ({ app, page }) => {
    await farmCloud(app);
    await app.launch({ responses: { connect_farm_device: FARM_DEVICE } });
    await signIn(app);
    await holdS24(app);
    await page.keyboard.press("Escape");
    await app.emit("farm://session", { type: "idle_warning", closes_at: Date.now() + 90_000 });
    await expect(
      page.getByText(/The session closes soon without activity \(1:[23]\d\)/),
    ).toBeVisible();
    await app.emit("farm://session", { type: "closing", reason: "idle" });
    await expect(page.getByText("Session closed after 5 minutes of inactivity.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Release" })).toHaveCount(0);
    await app.waitForCall("disconnect_device");
  });

  test("installs an APK on the farm phone", async ({ app, page }) => {
    await farmCloud(app);
    await app.launch({
      responses: {
        connect_farm_device: FARM_DEVICE,
        farm_install_apk: { ok: true, packages: ["com.example.app"], message: "" },
      },
    });
    await signIn(app);
    await holdS24(app);
    await page.keyboard.press("Escape");
    await app.answerDialogs("open", APK);
    await page.getByRole("button", { name: "Install APK" }).click();
    const [install] = await app.waitForCall("farm_install_apk");
    expect(install.args).toEqual({ path: APK });
    await expect(page.getByText("App installed")).toBeVisible();
    await expect(page.getByText("com.example.app")).toBeVisible();
  });

  test("a failed install says why", async ({ app, page }) => {
    await farmCloud(app);
    await app.launch({
      responses: {
        connect_farm_device: FARM_DEVICE,
        farm_install_apk: { ok: false, packages: [], message: "INSTALL_FAILED_OLDER_SDK" },
      },
    });
    await signIn(app);
    await holdS24(app);
    await page.keyboard.press("Escape");
    await app.answerDialogs("open", APK);
    await page.getByRole("button", { name: "Install APK" }).click();
    await expect(page.getByText("Install failed")).toBeVisible();
    await expect(page.getByText("INSTALL_FAILED_OLDER_SDK")).toBeVisible();
  });
});
