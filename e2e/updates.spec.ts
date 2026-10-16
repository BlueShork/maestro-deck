import { expect, test, type App } from "./support/app";

const UPDATE = {
  rid: 7,
  currentVersion: "1.2.0",
  version: "1.3.0",
  date: "2026-10-20",
  body: "## What's new\n\n- **GitLab** plugin support",
  rawJson: {},
};

const dialog = (app: App) => app.page.getByRole("dialog").filter({ hasText: "v1.3.0" });

async function progress(app: App, index: number, message: unknown) {
  const [call] = await app.calls("plugin:updater|download_and_install");
  const channel = (call.args as { onEvent: { id: number } | string }).onEvent;
  const id = typeof channel === "string" ? Number(channel.split(":")[1]) : channel.id;
  await app.page.evaluate(
    ([cb, msg]) =>
      (
        window as unknown as {
          __TAURI_INTERNALS__: { runCallback: (id: number, d: unknown) => void };
        }
      ).__TAURI_INTERNALS__.runCallback(cb, msg),
    [id, { index, message }] as const,
  );
}

test.describe("app updates", () => {
  test("found at startup, downloaded with progress, then the app restarts", async ({ app }) => {
    await app.launch({
      responses: { "plugin:updater|check": UPDATE },
      deferred: ["plugin:updater|download_and_install"],
    });
    await expect(dialog(app)).toBeVisible({ timeout: 8000 });
    await expect(dialog(app).getByText("New version")).toBeVisible();
    await expect(dialog(app).getByRole("heading", { name: "What's new" })).toBeVisible();
    await expect(dialog(app).locator("strong", { hasText: "GitLab" })).toBeVisible();

    await dialog(app).getByRole("button", { name: "Install update" }).click();
    const [call] = await app.waitForCall("plugin:updater|download_and_install");
    expect(call.args).toMatchObject({ rid: 7 });
    await progress(app, 0, { event: "Started", data: { contentLength: 1000 } });
    await progress(app, 1, { event: "Progress", data: { chunkLength: 250 } });
    await expect(dialog(app).getByText("25%")).toBeVisible();
    await expect(dialog(app).getByText("Downloading the new version…")).toBeVisible();
    await progress(app, 2, { event: "Finished" });
    await expect(dialog(app).getByText("Restarting…")).toBeVisible();
    await app.settle("plugin:updater|download_and_install");
    await app.waitForCall("plugin:process|restart");
  });

  test("Later puts it off", async ({ app, page }) => {
    await app.launch({ responses: { "plugin:updater|check": UPDATE } });
    await expect(dialog(app)).toBeVisible({ timeout: 8000 });
    await dialog(app).getByRole("button", { name: "Later" }).click();
    await expect(dialog(app)).toHaveCount(0);
    expect(await app.calls("plugin:updater|download_and_install")).toHaveLength(0);
    await page.getByRole("button", { name: /^v1\.2\.0$/ }).click();
    await expect(dialog(app)).toBeVisible();
  });

  test("a failed install says why and can be dismissed", async ({ app }) => {
    await app.launch({
      responses: { "plugin:updater|check": UPDATE },
      failures: { "plugin:updater|download_and_install": "signature verification failed" },
    });
    await expect(dialog(app)).toBeVisible({ timeout: 8000 });
    await dialog(app).getByRole("button", { name: "Install update" }).click();
    await expect(dialog(app).getByText("Update failed")).toBeVisible();
    await expect(dialog(app).getByText("signature verification failed")).toBeVisible();
    await dialog(app).getByRole("button", { name: "Dismiss" }).click();
    await expect(dialog(app)).toHaveCount(0);
    expect(await app.calls("plugin:process|restart")).toHaveLength(0);
  });

  test("a failed silent check stays silent", async ({ app, page }) => {
    await app.launch({ failures: { "plugin:updater|check": "offline" } });
    await app.waitForCall("plugin:updater|check");
    await page.waitForTimeout(300);
    await expect(page.getByText("Update check failed")).toHaveCount(0);
  });

  test("with automatic checks off, nothing is checked at startup", async ({ app, page }) => {
    await app.launch({
      storage: {
        "maestro-deck.settings": JSON.stringify({
          state: { autoCheckUpdatesEnabled: false },
          version: 0,
        }),
      },
    });
    await page.waitForTimeout(3500);
    expect(await app.calls("plugin:updater|check")).toHaveLength(0);
  });
});
