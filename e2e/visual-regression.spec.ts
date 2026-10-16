import { expect, test, type App } from "./support/app";
import { PASSING_RUN, PIXEL, WS, withWorkspace } from "./support/data";

const LOGIN = `${WS}/auth/login.yaml`;
const PNG = (seed: string) =>
  `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==#${seed}`;

const CHANGED = {
  run_id: "4242",
  device_key: "Pixel_7_1080x2400",
  comparisons: [
    { name: "home", flow: "Login", status: "match", changed_ratio: 0, bbox: null },
    {
      name: "login-form",
      flow: "Login",
      status: "changed",
      changed_ratio: 0.035,
      bbox: [40, 900, 600, 120],
      bank_b64: PNG("bank"),
      new_b64: PNG("new"),
      diff_b64: PNG("diff"),
    },
    {
      name: "welcome",
      flow: "Login",
      status: "dimension_mismatch",
      changed_ratio: 1,
      bbox: null,
      bank_b64: PNG("bank2"),
      new_b64: PNG("new2"),
    },
  ],
};

const scenario = (extra: Record<string, unknown> = {}, storage: Record<string, string> = {}) => ({
  ...withWorkspace,
  devices: [PIXEL],
  ...extra,
  storage: {
    ...withWorkspace.storage,
    "maestro-deck.workspace": JSON.stringify({
      state: { folderPath: WS, expanded: {}, lastOpenFile: LOGIN },
      version: 0,
    }),
    ...storage,
  },
});

async function passingRun(app: App, opts: { technical?: boolean } = {}) {
  await app.page
    .getByRole("button", { name: /Pixel 7/ })
    .first()
    .click();
  await expect(app.page.getByText("Live")).toBeVisible();
  await expect(app.page.locator(".cm-content")).toContainText("Welcome");
  if (opts.technical) await app.page.getByRole("button", { name: "Technical" }).click();
  await app.page.getByRole("button", { name: /^Run$/ }).click();
  await app.waitForCall("run_flow");
  for (const line of PASSING_RUN) await app.emit("runner:stdout", line);
  await app.emit("runner:exit", { pid: 4242, code: 0 });
}

const review = (app: App) => app.page.getByRole("dialog").filter({ hasText: "Visual regression" });

test.describe("visual regression", () => {
  test("compares the run's captures, then walks through each change", async ({ app, page }) => {
    await app.launch(scenario({ responses: { compare_screenshots: CHANGED } }));
    await passingRun(app);

    const [compare] = await app.waitForCall("compare_screenshots");
    expect(compare.args).toEqual({
      workspace: WS,
      flowPath: LOGIN,
      model: "Pixel 7",
      width: 1080,
      height: 2400,
      tolerance: 0.1,
      threshold: 0.001,
      runId: "4242",
      platform: "android",
      ignoreStatusBar: false,
    });
    await expect(page.getByText("Screenshot changes detected")).toBeVisible();

    await expect(review(app).getByText("login-form")).toBeVisible();
    await expect(review(app).getByText("1 of 2")).toBeVisible();
    await expect(review(app).getByText("3.50% of pixels changed")).toBeVisible();
    await expect(review(app).getByText("changed region 600×120 at (40, 900)")).toBeVisible();
    const capture = review(app).getByAltText("new capture");
    await expect(capture).toHaveAttribute("src", /#diff$/);
    await review(app).getByRole("button", { name: "Hide diff" }).click();
    await expect(capture).toHaveAttribute("src", /#new$/);
    await expect(review(app).getByAltText("bank reference")).toHaveAttribute("src", /#bank$/);

    await review(app).getByRole("button", { name: "Keep bank" }).click();
    const [keep] = await app.waitForCall("resolve_comparison");
    expect(keep.args).toEqual({
      workspace: WS,
      runId: "4242",
      deviceKey: "Pixel_7_1080x2400",
      name: "login-form",
      decision: "keep",
    });

    await expect(review(app).getByText("2 of 2")).toBeVisible();
    await expect(review(app).getByText("Dimensions differ from the baseline")).toBeVisible();
    await expect(review(app).getByRole("button", { name: /diff/ })).toHaveCount(0);
    await review(app).getByRole("button", { name: "Replace baseline" }).click();
    const calls = await app.waitForCall("resolve_comparison", 2);
    expect(calls[1].args).toMatchObject({ name: "welcome", decision: "replace" });
    await expect(review(app)).toHaveCount(0);
  });

  test("a clean bank just says so, without a review", async ({ app, page }) => {
    await app.launch(
      scenario({
        responses: {
          compare_screenshots: {
            run_id: "4242",
            device_key: "Pixel_7_1080x2400",
            comparisons: [
              { name: "home", status: "match", changed_ratio: 0, bbox: null },
              { name: "login-form", status: "match", changed_ratio: 0, bbox: null },
              { name: "welcome", status: "seeded", changed_ratio: 0, bbox: null },
              { name: "cart", status: "missing", changed_ratio: 0, bbox: null },
            ],
          },
        },
      }),
    );
    await passingRun(app, { technical: true });
    await expect(page.getByText("Screenshot bank ✓")).toBeVisible();
    await expect(page.getByText("[bank] 2 match · 0 changed · 1 new · 1 missing")).toBeVisible();
    await expect(page.getByText("[bank] 1 reference screenshot(s) created")).toBeVisible();
    await expect(page.getByText("[bank] 1 expected screenshot(s) missing")).toBeVisible();
    await expect(review(app)).toHaveCount(0);
  });

  test("a failed comparison is reported in a toast and the log", async ({ app, page }) => {
    await app.launch(scenario({ failures: { compare_screenshots: "bank folder is read-only" } }));
    await passingRun(app, { technical: true });
    await expect(page.getByText("Screenshot bank check failed")).toBeVisible();
    await expect(
      page.getByText(/\[bank\] comparison failed: .*bank folder is read-only/),
    ).toBeVisible();
  });

  test("a decision that can't be saved keeps the screenshot up for another try", async ({
    app,
    page,
  }) => {
    await app.launch(
      scenario({
        responses: { compare_screenshots: CHANGED },
        failures: { resolve_comparison: "disk full" },
      }),
    );
    await passingRun(app);
    await review(app).getByRole("button", { name: "Replace baseline" }).click();
    await expect(page.getByText("Could not update bank")).toBeVisible();
    await expect(review(app).getByText("1 of 2")).toBeVisible();
    await expect(review(app).getByRole("button", { name: "Replace baseline" })).toBeEnabled();
  });

  test("failed and stopped runs are not compared", async ({ app, page }) => {
    await app.launch(scenario({ responses: { compare_screenshots: CHANGED } }));
    await page
      .getByRole("button", { name: /Pixel 7/ })
      .first()
      .click();
    await expect(page.getByText("Live")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("Welcome");
    await page.getByRole("button", { name: /^Run$/ }).click();
    await app.waitForCall("run_flow");
    await app.emit("runner:exit", { pid: 4242, code: 1 });
    await expect(page.getByText("Test failed")).toBeVisible();
    await page.waitForTimeout(300);
    expect(await app.calls("compare_screenshots")).toHaveLength(0);
  });

  test("turned off in settings, nothing is compared", async ({ app, page }) => {
    await app.launch(scenario({ responses: { compare_screenshots: CHANGED } }));
    await page.goto("/#/settings/visual-regression");
    const toggle = page.getByRole("switch", { name: "Compare screenshots after each run" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByLabel("Per-pixel tolerance")).toBeDisabled();
    await page.goto("/#/");
    await passingRun(app);
    await expect(page.getByText("Flow completed")).toBeVisible();
    expect(await app.calls("compare_screenshots")).toHaveLength(0);
  });

  test("custom sensitivity and ignored system bars reach the comparison", async ({ app, page }) => {
    await app.launch(scenario({ responses: { compare_screenshots: CHANGED } }));
    await page.goto("/#/settings/visual-regression");
    await page.getByLabel("Per-pixel tolerance").fill("0.25");
    await page.getByLabel("Changed-pixel threshold").fill("0.01");
    await page.getByRole("switch", { name: "Ignore system chrome" }).click();
    await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeEnabled();
    await page.goto("/#/");
    await passingRun(app);
    const [compare] = await app.waitForCall("compare_screenshots");
    expect(compare.args).toMatchObject({ tolerance: 0.25, threshold: 0.01, ignoreStatusBar: true });
    await expect(review(app).getByText("system bars ignored")).toBeVisible();
  });

  test("Restore defaults clears the custom values", async ({ app, page }) => {
    await app.launch(
      scenario(
        {},
        {
          "maestro-deck.visual-regression": JSON.stringify({
            state: { enabled: true, tolerance: 0.3, threshold: 0.02, ignoreStatusBar: false },
            version: 0,
          }),
        },
      ),
    );
    await page.goto("/#/settings/visual-regression");
    await expect(page.getByLabel("Per-pixel tolerance")).toHaveValue("0.3");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(page.getByLabel("Per-pixel tolerance")).toHaveValue("0.1");
    await expect(page.getByLabel("Changed-pixel threshold")).toHaveValue("0.001");
    await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeDisabled();
  });

  test("Run all compares every flow and lists them per flow", async ({ app, page }) => {
    await app.launch(
      scenario({
        responses: {
          compare_screenshots_all: {
            run_id: "4242",
            device_key: "Pixel_7_1080x2400",
            comparisons: [
              { name: "home", flow: "Login", status: "match", changed_ratio: 0, bbox: null },
              { name: "cart", flow: "Checkout", status: "match", changed_ratio: 0, bbox: null },
            ],
            flow_errors: ["Checkout: 1 screenshot taken twice"],
          },
        },
      }),
    );
    await page
      .getByRole("button", { name: /Pixel 7/ })
      .first()
      .click();
    await expect(page.getByText("Live")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("Welcome");
    await page.getByRole("button", { name: "Technical" }).click();
    await page.getByRole("button", { name: /Run all/ }).click();
    await app.waitForCall("run_flow");
    await app.emit("runner:exit", { pid: 4242, code: 0 });
    const [compare] = await app.waitForCall("compare_screenshots_all");
    expect(compare.args).not.toHaveProperty("flowPath");
    await expect(page.getByText("[bank] flows — Login: 1 · Checkout: 1")).toBeVisible();
    await expect(page.getByText("[bank] Checkout: 1 screenshot taken twice")).toBeVisible();
  });
});
