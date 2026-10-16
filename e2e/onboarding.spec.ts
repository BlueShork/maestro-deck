import { expect, test, type App } from "./support/app";
import { fakeCloud } from "./support/cloud";
import { FAILING_RUN, PIXEL, WS, withWorkspace } from "./support/data";

const walkthrough = (app: App) =>
  app.page
    .locator("div.fixed.inset-0")
    .filter({ has: app.page.getByLabel("Leave the walkthrough") });

async function startFromSettings(app: App) {
  await app.page.goto("/#/settings/general");
  await app.page.getByRole("button", { name: "Start walkthrough" }).click();
  await expect(app.page).toHaveURL(/#\/$/);
  await expect(app.page.getByText("Where should your first test run?")).toBeVisible();
}

const SAMPLE = `${WS}/onboarding.yaml`;

test.describe("hands-on walkthrough", () => {
  test("on a phone: install the sample, write the flow, run it to a pass", async ({
    app,
    page,
  }) => {
    await app.launch({ ...withWorkspace, devices: [] });
    await startFromSettings(app);
    await page.getByRole("button", { name: /On your phone/ }).click();
    await expect(page.getByText("Waiting for a device…")).toBeVisible();

    await app.setDevices([PIXEL]);
    await page.getByRole("button", { name: "Install it on Pixel 7" }).click();
    const [connect] = await app.waitForCall("connect_device");
    expect(connect.args).toMatchObject({ serial: "emulator-5554" });
    const [install] = await app.waitForCall("install_sample_app");
    expect(install.args).toEqual({ serial: "emulator-5554" });

    await page.getByRole("button", { name: "Create onboarding.yaml" }).click();
    await expect.poll(() => app.file(SAMPLE)).toContain("appId: com.maestrodeck.sample");
    await expect(page.locator(".cm-content")).toContainText('assertVisible: "Welcome back!"');

    await expect(page.getByText("Waiting for you to press Run.")).toBeVisible();
    await page.getByRole("button", { name: /^Run$/ }).click();
    const [run] = await app.waitForCall("run_flow");
    expect(run.args).toMatchObject({ filePath: SAMPLE });
    await expect(walkthrough(app).getByText("Running…")).toBeVisible();
    await app.emit("runner:exit", { pid: 4242, code: 0 });

    await expect(page.getByText("That was it.")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(walkthrough(app)).toHaveCount(0);
    const saved = await page.evaluate(() => localStorage.getItem("maestro-deck.onboarding"));
    expect(JSON.parse(saved!).state.done).toBe(true);
  });

  test("a failed run is explained, not hidden", async ({ app, page }) => {
    await app.launch({ ...withWorkspace, devices: [PIXEL] });
    await startFromSettings(app);
    await page.getByRole("button", { name: /On your phone/ }).click();
    await page.getByRole("button", { name: "Install it on Pixel 7" }).click();
    await page.getByRole("button", { name: "Create onboarding.yaml" }).click();
    await page.getByRole("button", { name: /^Run$/ }).click();
    await app.waitForCall("run_flow");
    for (const line of FAILING_RUN) await app.emit("runner:stdout", line);
    await app.emit("runner:exit", { pid: 4242, code: 1 });
    await expect(page.getByText("It did not pass — and that is worth seeing too")).toBeVisible();
    await page.getByRole("button", { name: "Close and take a look" }).click();
    await expect(walkthrough(app)).toHaveCount(0);
  });

  test("a failed install keeps the user on the install step", async ({ app, page }) => {
    await app.launch({
      ...withWorkspace,
      devices: [PIXEL],
      failures: { install_sample_app: "INSTALL_FAILED_INSUFFICIENT_STORAGE" },
    });
    await startFromSettings(app);
    await page.getByRole("button", { name: /On your phone/ }).click();
    await page.getByRole("button", { name: "Install it on Pixel 7" }).click();
    await expect(page.getByText("INSTALL_FAILED_INSUFFICIENT_STORAGE")).toBeVisible();
    await expect(page.getByRole("button", { name: "Install it on Pixel 7" })).toBeEnabled();
  });

  test("without a folder, it asks for one and continues once it is open", async ({ app, page }) => {
    await app.launch({
      files: withWorkspace.files,
      trees: withWorkspace.trees,
      devices: [PIXEL],
      dialogs: { open: [WS] },
    });
    await startFromSettings(app);
    await page.getByRole("button", { name: /On your phone/ }).click();
    await page.getByRole("button", { name: "Install it on Pixel 7" }).click();
    await expect(page.getByText("Choose where your flows live")).toBeVisible();
    await page.getByRole("button", { name: "Open folder" }).last().click();
    await expect(page.getByRole("button", { name: "Create onboarding.yaml" })).toBeVisible();
  });

  test("in the cloud: signs in inside the walkthrough, then arms the sample app", async ({
    app,
    page,
  }) => {
    await fakeCloud(page);
    await app.launch({ ...withWorkspace, responses: { sample_app_apk: "/app/sample.apk" } });
    await startFromSettings(app);
    await page.getByRole("button", { name: /In the cloud/ }).click();
    await expect(page.getByText("Create your account")).toBeVisible();
    await page.getByPlaceholder("you@example.com").fill("me@example.com");
    await page.getByPlaceholder("At least 6 characters").fill("hunter22");
    await page.getByRole("button", { name: "Continue with email" }).click();

    await expect(page.getByRole("heading", { name: "Nothing to install" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Create onboarding.yaml" }).click();
    await expect(page.getByRole("button", { name: "Run in cloud" })).toBeEnabled();
    await app.waitForCall("sample_app_apk");
    await expect(page.getByText(/Press Run in cloud, up in the toolbar/)).toBeVisible();
  });

  test("starts on its own at the end of the first-run tour, and never comes back once left", async ({
    app,
    page,
  }) => {
    await app.launch({}, { firstRun: true });
    await page.getByRole("button", { name: "No thanks" }).click();
    await expect(page.getByText("Connect your phone")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByText("Connect your phone")).toBeVisible();
    while (await page.getByRole("button", { name: "Next" }).isVisible()) {
      await page.getByRole("button", { name: "Next" }).click();
    }
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByText("Where should your first test run?")).toBeVisible();
    await page.getByLabel("Leave the walkthrough").click();
    await expect(page.getByText("Where should your first test run?")).toBeHidden();
    await page.reload();
    await page.locator("#splash").waitFor({ state: "detached" });
    await expect(page.getByText("Where should your first test run?")).toBeHidden();
  });

  test("skipping the tour is not a request for more", async ({ app, page }) => {
    await app.launch({}, { firstRun: true });
    await page.getByRole("button", { name: "No thanks" }).click();
    await page.getByRole("button", { name: "Skip tour" }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText("Where should your first test run?")).toBeHidden();
  });

  test("a returning user meets it once the toolchain is ready", async ({ app, page }) => {
    await app.launch({
      storage: {
        "maestro-deck.onboarding": JSON.stringify({ state: { done: false }, version: 0 }),
      },
    });
    await expect(page.getByText("Where should your first test run?")).toBeVisible();
  });

  test("…but not before", async ({ app, page }) => {
    await app.launch({
      responses: { environment_status: { checks: [], minimalOk: false } },
      storage: {
        "maestro-deck.onboarding": JSON.stringify({ state: { done: false }, version: 0 }),
      },
    });
    await page.waitForTimeout(500);
    await expect(page.getByText("Where should your first test run?")).toBeHidden();
  });
});
