/**
 * Visual regression: the main screens, pixel-compared against the references
 * in visual.spec.ts-snapshots/. A deliberate UI change means refreshing them:
 *   pnpm test:e2e --update-snapshots
 * then reviewing the new PNGs in the diff before committing. The references
 * are macOS renders: run this file on a Mac.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, test, type App } from "./support/app";
import {
  FAILING_RUN,
  IPHONE_SIM,
  PASSING_RUN,
  PIXEL,
  WS,
  screenPng,
  withWorkspace,
} from "./support/data";

const dark = (scenario: { storage?: Record<string, string> }) => ({
  ...scenario,
  storage: {
    ...scenario.storage,
    "maestro-deck.settings": JSON.stringify({ state: { theme: "dark" }, version: 0 }),
  },
});

/** Things that legitimately differ between runs: elapsed timers, toasts. */
const volatile = (page: Page): Locator[] => [
  page.locator(".ll-root"),
  page.locator("[role=alert]"),
  page.locator(".fixed.bottom-4.right-4"),
];

async function snap(page: Page, name: string, target?: Locator) {
  await page.evaluate(() => document.fonts.ready);
  const opts = { mask: volatile(page) };
  if (target) await expect(target).toHaveScreenshot(`${name}.png`, opts);
  else await expect(page).toHaveScreenshot(`${name}.png`, opts);
}

const openedFlow = {
  ...withWorkspace,
  devices: [PIXEL],
  storage: {
    // A taller console, so the step list is part of the picture.
    "react-resizable-panels:maestro-deck.layout.main.v2": JSON.stringify({
      "main-bottom,main-top": { expandToSizes: {}, layout: [55, 45] },
    }),
    "maestro-deck.workspace": JSON.stringify({
      state: { folderPath: WS, expanded: {}, lastOpenFile: `${WS}/auth/login.yaml` },
      version: 0,
    }),
  },
};

async function finishedRun(app: App, lines: string[], code: number) {
  await expect(app.page.locator(".cm-content")).toContainText("Welcome");
  await app.page.getByRole("button", { name: /^Run$/ }).click();
  await app.waitForCall("run_flow");
  for (const line of lines) await app.emit("runner:stdout", line);
  await app.emit("runner:exit", { pid: 4242, code });
  await expect(
    app.page
      .getByText(`[runner exited with code ${code}]`)
      .or(app.page.getByText(code === 0 ? "Test passed" : "Test failed")),
  ).toBeVisible();
}

async function mirroredSim(app: App) {
  await app.page
    .getByRole("button", { name: /iPhone 16 Pro/ })
    .first()
    .click();
  await app.waitForCall("connect_device");
  await app.emit("ios_frame", { data: screenPng(402, 874), width: 402, height: 874 });
  await expect(app.page.locator("canvas")).toBeVisible();
}

// Tagged: references are rendered on macOS (fonts differ per OS), so CI on
// Linux runs the functional specs only — run these locally before a release.
test.describe("visual", { tag: "@visual" }, () => {
  test("workspace, first launch state", async ({ app, page }) => {
    await app.launch();
    await snap(page, "workspace-empty-light");
  });

  test("workspace, dark theme", async ({ app, page }) => {
    await app.launch(dark({}));
    await expect(page.locator("html")).toHaveClass(/dark/);
    await snap(page, "workspace-empty-dark");
  });

  test("a flow open, after a passing run", async ({ app, page }) => {
    await app.launch(openedFlow);
    await finishedRun(app, PASSING_RUN, 0);
    await snap(page, "run-passed");
  });

  test("a flow open, after a failing run (dark)", async ({ app, page }) => {
    await app.launch(dark(openedFlow));
    await finishedRun(app, FAILING_RUN, 1);
    await snap(page, "run-failed-dark");
  });

  test("technical console", async ({ app, page }) => {
    await app.launch(openedFlow);
    await page.getByRole("button", { name: "Technical" }).click();
    await finishedRun(app, PASSING_RUN, 0);
    await snap(
      page,
      "console-technical",
      page.locator("section").filter({ hasText: "Console" }).last(),
    );
  });

  test("iOS simulator mirrored", async ({ app, page }) => {
    await app.launch({ devices: [IPHONE_SIM] });
    await mirroredSim(app);
    await snap(page, "device-mirrored");
  });

  test("inspect menu over the mirror", async ({ app, page }) => {
    await app.launch({
      devices: [IPHONE_SIM],
      responses: {
        enter_inspect_mode: {
          xml_raw: "",
          root: {
            id: "1",
            resource_id: "login_button",
            text: "Log in",
            content_desc: null,
            class_name: "Button",
            package: "com.example.app",
            bounds: { left: 60, top: 393, right: 342, bottom: 454 },
            clickable: true,
            enabled: true,
            focused: false,
            children: [],
          },
        },
        query_element: {
          id: "1",
          resource_id: "login_button",
          text: "Log in",
          content_desc: null,
          class_name: "Button",
          package: "com.example.app",
          bounds: { left: 60, top: 393, right: 342, bottom: 454 },
          clickable: true,
          enabled: true,
          focused: false,
          children: [],
        },
        suggest_selectors: [
          { kind: "resourceId", value: "login_button" },
          { kind: "text", value: "Log in" },
        ],
      },
    });
    await mirroredSim(app);
    await page.getByRole("button", { name: "Toggle inspect mode" }).click();
    await expect(page.getByRole("button", { name: "Toggle inspect mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const box = (await page.locator("canvas").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.48, { button: "right" });
    await expect(page.getByRole("menu").first()).toBeVisible();
    await snap(page, "inspect-menu");
    await page.getByRole("menuitem", { name: /^Tap/ }).hover();
    await expect(page.getByText("recommended")).toBeVisible();
    await snap(page, "inspect-menu-selectors");
  });

  test("settings, general", async ({ app, page }) => {
    await app.launch();
    await page.goto("/#/settings/general");
    await expect(page.getByRole("button", { name: "Dark" })).toBeVisible();
    await snap(page, "settings-general");
  });

  test("settings, Billy AI (dark)", async ({ app, page }) => {
    await app.launch(dark({}));
    await page.goto("/#/settings/ai");
    await expect(page.getByLabel("Provider")).toBeVisible();
    await expect(page.getByLabel("Billy system prompt")).toBeVisible();
    await snap(page, "settings-ai-dark");
  });

  test("image bank", async ({ app, page }) => {
    await app.launch({
      ...withWorkspace,
      responses: {
        list_bank: [
          {
            device_key: "Pixel_7_1080x2400",
            images: ["home", "login", "cart", "checkout"].map((name) => ({
              name,
              width: 1080,
              height: 2400,
              size_bytes: 120000,
              modified_ms: 0,
            })),
          },
          { device_key: "iPhone_16_Pro_1206x2622", images: [] },
        ],
        load_bank_image: `data:image/png;base64,${screenPng(108, 240)}`,
      },
    });
    await page.goto("/#/image-bank");
    await expect(page.getByRole("img", { name: "checkout" })).toBeVisible();
    await snap(page, "image-bank");
  });

  test("Billy panel without a provider", async ({ app, page }) => {
    await app.launch();
    await page.getByRole("button", { name: "Toggle AI assistant" }).click();
    await expect(page.getByText("Bring your own key")).toBeVisible();
    await snap(page, "billy-panel");
  });

  test("telemetry consent on first launch", async ({ app, page }) => {
    await app.launch({}, { firstRun: true });
    await expect(page.getByRole("dialog")).toBeVisible();
    await snap(page, "first-run-consent");
  });

  test("quit confirmation", async ({ app, page }) => {
    await app.launch();
    await app.emit("quit-requested");
    await expect(page.getByText("Quit Maestro Deck?")).toBeVisible();
    await snap(page, "quit-dialog");
  });

  test("device picker", async ({ app, page }) => {
    await app.launch({ devices: [PIXEL, IPHONE_SIM] });
    await page.getByRole("banner").getByRole("button", { name: "Choose a device" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await snap(page, "device-picker");
  });
});
