import { expect, test } from "./support/app";
import { WS, withWorkspace } from "./support/data";

test.describe("first run", () => {
  test("asks for telemetry consent, then starts the tour", async ({ app, page }) => {
    await app.launch({}, { firstRun: true });
    const consent = page.getByRole("dialog");
    await expect(consent.getByText("Help us understand how Maestro Deck is used")).toBeVisible();
    await consent.getByRole("button", { name: "No thanks" }).click();
    await expect(page.getByText("Connect your phone")).toBeVisible();
    await page.getByRole("button", { name: "Skip tour" }).click();
    await expect(page.getByText("Connect your phone")).toBeHidden();
    const saved = await page.evaluate(() => localStorage.getItem("maestro-deck.telemetry"));
    expect(JSON.parse(saved!).state.consent).toBe("denied");
  });

  test("the tour walks through its steps", async ({ app, page }) => {
    await app.launch({}, { firstRun: true });
    await page.getByRole("button", { name: "No thanks" }).click();
    await expect(page.getByText("Connect your phone")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Mirror & inspect")).toBeVisible();
  });

  test("never asks again once answered", async ({ app, page }) => {
    await app.launch();
    await expect(page.getByText("Help us understand how Maestro Deck is used")).toBeHidden();
    await expect(page.getByText("Connect your phone")).toBeHidden();
  });
});

test.describe("navigation", () => {
  test("settings: every section opens and the workspace comes back", async ({ app, page }) => {
    await app.launch();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page).toHaveURL(/#\/settings\/general$/);
    const sections: Array<[string, string]> = [
      ["Privacy", "privacy"],
      ["Editor & Flows", "editor"],
      ["Toolchain", "toolchain"],
      ["Billy AI", "ai"],
      ["Visual Regression", "visual-regression"],
      ["About", "about"],
    ];
    for (const [label, id] of sections) {
      await page.getByRole("button", { name: label, exact: true }).first().click();
      await expect(page).toHaveURL(new RegExp(`#/settings/${id}$`));
      await expect(page.locator("main, [role=main], body").first()).not.toBeEmpty();
    }
    await page.goBack();
    await page.goto("/#/");
    await expect(page.getByText("No folder open")).toBeVisible();
  });

  test("the theme switch applies immediately and persists", async ({ app, page }) => {
    await app.launch();
    await page.goto("/#/settings/general");
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("button", { name: "Light" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    const saved = await page.evaluate(() => localStorage.getItem("maestro-deck.settings"));
    expect(JSON.parse(saved!).state.theme).toBe("light");
  });

  test("the toolchain page shows the resolved tool paths", async ({ app, page }) => {
    await app.launch();
    await page.goto("/#/settings/toolchain");
    await expect(page.getByText("/opt/homebrew/bin/adb").first()).toBeVisible();
  });

  test("image bank, plugins and account pages open from the toolbar", async ({ app, page }) => {
    await app.launch(withWorkspace);
    await page.getByRole("button", { name: "Open image bank" }).click();
    await expect(page.getByText("No baselines yet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/#\/$/);

    await page.getByRole("button", { name: "Open plugins" }).click();
    await expect(page).toHaveURL(/#\/plugins$/);
    await page.goto("/#/");

    await page
      .getByRole("banner")
      .getByRole("button", { name: "Maestro Deck Cloud account" })
      .click();
    await expect(page).toHaveURL(/#\/account$/);
  });

  test("the image bank lists baselines per device", async ({ app, page }) => {
    await app.launch({
      ...withWorkspace,
      responses: {
        list_bank: [
          {
            device_key: "Pixel_7_1080x2400",
            images: [
              { name: "home", width: 1080, height: 2400, size_bytes: 120000, modified_ms: 0 },
              { name: "login", width: 1080, height: 2400, size_bytes: 98000, modified_ms: 0 },
            ],
          },
        ],
      },
    });
    await page.goto("/#/image-bank");
    await expect(page.getByRole("heading", { name: "Pixel 7" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open home" })).toBeVisible();
    await page.getByRole("button", { name: "Open login" }).click();
    await expect(page.getByText("2 / 2")).toBeVisible();
    expect((await app.calls("list_bank"))[0].args).toEqual({ workspace: WS });
  });

  test("unknown routes fall back to the workspace", async ({ app, page }) => {
    await app.launch();
    await page.goto("/#/nowhere");
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByText("No folder open")).toBeVisible();
  });
});

test.describe("quitting", () => {
  test("asks for confirmation, then lets the backend tear everything down", async ({
    app,
    page,
  }) => {
    await app.launch();
    await app.emit("quit-requested");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Quit Maestro Deck?")).toBeVisible();
    await dialog.getByRole("button", { name: "Quit" }).click();
    await app.waitForCall("confirm_quit");
  });

  test("Cancel keeps the app open", async ({ app, page }) => {
    await app.launch();
    await app.emit("quit-requested");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(await app.calls("confirm_quit")).toHaveLength(0);
  });

  test("unsaved edits are offered for saving before quitting", async ({ app, page }) => {
    await app.launch({
      ...withWorkspace,
      storage: {
        ...withWorkspace.storage,
        "maestro-deck.settings": JSON.stringify({ state: { autoSaveEnabled: false }, version: 0 }),
      },
    });
    await page.getByText("checkout.yaml").click();
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("- back");
    await app.answerDialogs("message", "Save");
    await app.emit("quit-requested");
    await app.waitForCall("confirm_quit");
    expect(await app.file(`${WS}/checkout.yaml`)).toContain("- back");
    await expect(page.getByText("Quit Maestro Deck?")).toBeHidden();
  });
});

test.describe("Billy", () => {
  test("the assistant panel opens, points to settings without a provider, and closes", async ({
    app,
    page,
  }) => {
    await app.launch();
    await page.getByRole("button", { name: "Toggle AI assistant" }).click();
    await expect(page.getByText("Bring your own key")).toBeVisible();
    await expect(page.getByPlaceholder("Message Billy…")).toBeVisible();
    await page.getByRole("button", { name: "Toggle AI assistant" }).click();
    await expect(page.getByText("Bring your own key")).toBeHidden();
  });

  test("Open settings leads to the Billy AI section", async ({ app, page }) => {
    await app.launch();
    await page.getByRole("button", { name: "Toggle AI assistant" }).click();
    await page.getByRole("button", { name: "Open settings" }).click();
    await expect(page).toHaveURL(/#\/settings\/ai$/);
  });
});

test.describe("updates", () => {
  test("checking by hand with no update says so", async ({ app, page }) => {
    await app.launch();
    await page.getByRole("button", { name: /^v1\.2\.0$/ }).click();
    await expect(page.getByText("You're up to date")).toBeVisible();
  });

  test("a failed check is reported", async ({ app, page }) => {
    await app.launch({ failures: { "plugin:updater|check": "network unreachable" } });
    await page.getByRole("button", { name: /^v1\.2\.0$/ }).click();
    await expect(page.getByText("network unreachable").first()).toBeVisible();
  });
});
