import { expect, test, type App } from "./support/app";
import { fakeCloud, signIn } from "./support/cloud";
import { LOGIN_FLOW, PIXEL, WS, withWorkspace } from "./support/data";

const LOGIN = `${WS}/auth/login.yaml`;
const opened = {
  ...withWorkspace,
  devices: [PIXEL],
  storage: {
    ...withWorkspace.storage,
    "maestro-deck.workspace": JSON.stringify({
      state: { folderPath: WS, expanded: {}, lastOpenFile: LOGIN },
      version: 0,
    }),
  },
};

const editor = (app: App) => app.page.locator(".cm-content");
const line = (app: App, text: string) => app.page.locator(".cm-line", { hasText: text });

test.describe("step menu", () => {
  test("Run from this step runs only the rest, and highlights the original lines", async ({
    app,
    page,
  }) => {
    await app.launch(opened);
    await expect(editor(app)).toContainText("Welcome");
    await line(app, "inputText").click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu.getByText("inputText")).toBeVisible();
    await expect(menu.getByText("Line 6 · user@example.com")).toBeVisible();
    await menu.getByRole("menuitem", { name: "Run from this step" }).click();

    const [run] = await app.waitForCall("run_flow");
    expect(run.args).toMatchObject({ filePath: "/tmp/maestro-deck-flow.yaml" });
    expect(await app.file("/tmp/maestro-deck-flow.yaml")).toBe(
      'appId: com.example.app\nname: Login\n---\n- inputText: "user@example.com"\n- assertVisible: "Welcome"\n',
    );
    expect(await app.file(LOGIN)).toBe(LOGIN_FLOW);

    await app.emit("runner:stdout", " > Flow Login");
    await app.emit("runner:stdout", 'Input text "user@example.com"... COMPLETED');
    await app.emit("runner:stdout", 'Assert that "Welcome" is visible... COMPLETED');
    await app.emit("runner:exit", { pid: 4242, code: 0 });
    await expect(page.getByText("Test passed")).toBeVisible();
    const done = page.locator(".cm-lineNumbers .cm-step-line-done");
    await expect(done).toHaveCount(2);
    await expect(done.first()).toHaveText("6");
    await expect(done.last()).toHaveText("7");
  });

  test("a right-click between steps targets the next step", async ({ app, page }) => {
    await app.launch(opened);
    await expect(editor(app)).toContainText("Welcome");
    await line(app, "---").click({ button: "right" });
    await expect(page.getByRole("menu").getByText(/^Line 4/)).toBeVisible();
  });

  test("signed in with hosted Billy, a step can be sent to Billy as a draft", async ({
    app,
    page,
  }) => {
    await fakeCloud(page);
    await app.launch(opened);
    await signIn(app);
    await expect(editor(app)).toContainText("Welcome");
    await line(app, "tapOn").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Ask Billy about this step" }).click();
    const input = page.getByPlaceholder("Message Billy…");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(
      /About this step \(line 5\):\n\n```yaml\n- tapOn: "Login"\n```/,
    );
  });

  test("without hosted Billy, the menu doesn't offer it", async ({ app, page }) => {
    await app.launch(opened);
    await expect(editor(app)).toContainText("Welcome");
    await line(app, "tapOn").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Run from this step" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Ask Billy/ })).toHaveCount(0);
  });
});

test.describe("editor files", () => {
  test("Open loads a flow from anywhere on disk", async ({ app, page }) => {
    await app.launch({
      ...opened,
      files: { ...opened.files, "/elsewhere/smoke.yaml": "appId: x\n---\n- launchApp\n- back\n" },
      dialogs: { open: ["/elsewhere/smoke.yaml"] },
    });
    await expect(editor(app)).toContainText("Welcome");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(editor(app)).toContainText("- back");
    await expect(page.getByText("smoke.yaml").first()).toBeVisible();
  });

  test("Save As writes a copy and makes it the file reopened next time", async ({ app, page }) => {
    await app.launch({ ...opened, dialogs: { save: ["/elsewhere/login-copy.yaml"] } });
    await expect(editor(app)).toContainText("Welcome");
    await page.getByRole("button", { name: "Save As" }).click();
    await expect.poll(() => app.file("/elsewhere/login-copy.yaml")).toBe(LOGIN_FLOW);
    const saved = await page.evaluate(() => localStorage.getItem("maestro-deck.workspace"));
    expect(JSON.parse(saved!).state.lastOpenFile).toBe("/elsewhere/login-copy.yaml");
  });

  test("saving an untitled buffer asks where, and a cancel writes nothing", async ({
    app,
    page,
  }) => {
    await app.launch({ dialogs: { save: [null] } });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await app.waitForCall("plugin:dialog|save");
    expect(await app.calls("plugin:fs|write_text_file")).toHaveLength(0);
  });

  test("a failed save is reported and the edits stay unsaved", async ({ app, page }) => {
    await app.launch({
      ...opened,
      failures: { "plugin:fs|write_text_file": "disk full" },
      storage: {
        ...opened.storage,
        "maestro-deck.settings": JSON.stringify({ state: { autoSaveEnabled: false }, version: 0 }),
      },
    });
    await expect(editor(app)).toContainText("Welcome");
    await editor(app).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("- back");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Save failed")).toBeVisible();
    await expect(page.getByTitle("Unsaved changes")).toBeVisible();
  });
});

test.describe("macOS menu bar", () => {
  test("menu items drive the same actions as the toolbar", async ({ app, page }) => {
    await app.launch({ ...opened, dialogs: { save: ["/elsewhere/menu.yaml"] } });
    await expect(editor(app)).toContainText("Welcome");

    await app.emit("menu:action", "settings");
    await expect(page).toHaveURL(/#\/settings/);
    await app.emit("menu:action", "image-bank");
    await expect(page).toHaveURL(/#\/image-bank$/);
    await app.emit("menu:action", "account");
    await expect(page).toHaveURL(/#\/account$/);

    await app.emit("menu:action", "run");
    await expect(page).toHaveURL(/#\/$/);
    const [run] = await app.waitForCall("run_flow");
    expect(run.args).toMatchObject({ filePath: LOGIN });
    await app.emit("menu:action", "stop");
    const [stop] = await app.waitForCall("stop_flow");
    expect(stop.args).toEqual({ pid: 4242 });
    await app.emit("runner:exit", { pid: 4242, code: null });

    await app.emit("menu:action", "save-as");
    await expect.poll(() => app.file("/elsewhere/menu.yaml")).toBe(LOGIN_FLOW);

    await app.emit("menu:action", "ai-assistant");
    await expect(page.getByPlaceholder("Message Billy…")).toBeVisible();
    await expect
      .poll(async () => (await app.calls("set_menu_checked")).map((c) => JSON.stringify(c.args)))
      .toContain(JSON.stringify({ id: "ai-assistant", checked: true }));

    await app.emit("menu:action", "docs");
    const [docs] = await app.waitForCall("plugin:opener|open_url");
    expect(docs.args).toMatchObject({ url: "https://www.maestrodeck.cloud/docs" });
  });

  test("panel items hide and show panels, and Show all restores them", async ({ app, page }) => {
    await app.launch(opened);
    await expect(page.getByText("Workspace", { exact: true })).toBeVisible();
    await app.emit("menu:action", "panel:workspace");
    await expect(page.getByText("Workspace", { exact: true })).toBeHidden();
    await expect
      .poll(async () => (await app.calls("set_menu_checked")).map((c) => JSON.stringify(c.args)))
      .toContain(JSON.stringify({ id: "panel:workspace", checked: false }));
    await app.emit("menu:action", "show-all-panels");
    await expect(page.getByText("Workspace", { exact: true })).toBeVisible();
  });

  test("Open folder from the menu opens the picked workspace", async ({ app, page }) => {
    await app.launch({
      files: withWorkspace.files,
      trees: withWorkspace.trees,
      dialogs: { open: [WS] },
    });
    await expect(page.getByText("No folder open")).toBeVisible();
    await app.emit("menu:action", "open-folder");
    await expect(page.getByText("checkout.yaml")).toBeVisible();
  });
});
