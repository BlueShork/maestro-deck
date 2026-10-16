import { expect, test, type App } from "./support/app";
import {
  CHECKOUT_FLOW,
  LOGIN_FLOW,
  WORKSPACE_FILES,
  WORKSPACE_TREE,
  WS,
  withWorkspace,
} from "./support/data";

const autosaveOff = {
  ...withWorkspace,
  storage: {
    ...withWorkspace.storage,
    "maestro-deck.settings": JSON.stringify({ state: { autoSaveEnabled: false }, version: 0 }),
  },
};

const editor = (app: App) => app.page.locator(".cm-content");

async function typeAtEnd(app: App, text: string) {
  await editor(app).click();
  await app.page.keyboard.press("ControlOrMeta+End");
  await app.page.keyboard.type(text);
}

test.describe("workspace", () => {
  test("opens a folder from the empty state and lists its flows", async ({ app, page }) => {
    await app.launch({
      files: WORKSPACE_FILES,
      trees: { [WS]: WORKSPACE_TREE },
      dialogs: { open: [WS] },
    });
    await page.getByRole("button", { name: "Open folder" }).last().click();
    await expect(page.getByText("checkout.yaml")).toBeVisible();
    await expect(page.getByText("login.yaml")).toBeVisible();
    expect((await app.calls("list_workspace"))[0].args).toEqual({ path: WS });
  });

  test("clicking a flow opens it in the editor", async ({ app, page }) => {
    await app.launch(withWorkspace);
    await page.getByText("checkout.yaml").click();
    await expect(editor(app)).toContainText('tapOn: "Cart"');
    await expect(page.getByText("checkout.yaml").last()).toBeVisible();
  });

  test("edits are marked unsaved and Save writes them to disk", async ({ app, page }) => {
    await app.launch(autosaveOff);
    await page.getByText("checkout.yaml").click();
    await expect(editor(app)).toContainText("Cart");
    await typeAtEnd(app, "- back");
    await expect(page.getByTitle("Unsaved changes")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTitle("Unsaved changes")).toBeHidden();
    expect(await app.file(`${WS}/checkout.yaml`)).toBe(`${CHECKOUT_FLOW}- back`);
  });

  test("switching files with unsaved edits asks first; Cancel keeps them", async ({
    app,
    page,
  }) => {
    await app.launch(autosaveOff);
    await page.getByText("checkout.yaml").click();
    await typeAtEnd(app, "- back");
    await app.answerDialogs("message", "Cancel");
    await page.getByText("login.yaml").click();
    await expect.poll(async () => (await app.calls("plugin:dialog|message")).length).toBe(1);
    await expect(editor(app)).toContainText("- back");
    await expect(editor(app)).not.toContainText("Welcome");
    expect(await app.file(`${WS}/checkout.yaml`)).toBe(CHECKOUT_FLOW);
  });

  test("…Save writes them before switching", async ({ app, page }) => {
    await app.launch(autosaveOff);
    await page.getByText("checkout.yaml").click();
    await typeAtEnd(app, "- back");
    await app.answerDialogs("message", "Save");
    await page.getByText("login.yaml").click();
    await expect(editor(app)).toContainText("Welcome");
    expect(await app.file(`${WS}/checkout.yaml`)).toBe(`${CHECKOUT_FLOW}- back`);
  });

  test("…Don't Save drops them", async ({ app, page }) => {
    await app.launch(autosaveOff);
    await page.getByText("checkout.yaml").click();
    await typeAtEnd(app, "- back");
    await app.answerDialogs("message", "Don't Save");
    await page.getByText("login.yaml").click();
    await expect(editor(app)).toContainText("Welcome");
    expect(await app.file(`${WS}/checkout.yaml`)).toBe(CHECKOUT_FLOW);
  });

  test("with autosave on (the default), edits are saved without asking", async ({ app, page }) => {
    await app.launch(withWorkspace);
    await page.getByText("checkout.yaml").click();
    await typeAtEnd(app, "- back");
    await expect
      .poll(() => app.file(`${WS}/checkout.yaml`), { timeout: 5000 })
      .toBe(`${CHECKOUT_FLOW}- back`);
  });

  test("creates a flow from the tree and opens it", async ({ app, page }) => {
    await app.launch(withWorkspace);
    await expect(page.getByText("checkout.yaml")).toBeVisible();
    await page.getByRole("button", { name: "New flow", exact: true }).click();
    await page.getByPlaceholder("flow-name.yaml").fill("signup");
    await page.keyboard.press("Enter");
    await expect.poll(() => app.file(`${WS}/signup.yaml`)).toContain("launchApp");
    await expect(page.getByText("signup.yaml").last()).toBeVisible();
  });

  test("deletes a flow after confirmation", async ({ app, page }) => {
    await app.launch(withWorkspace);
    await app.answerDialogs("message", "Delete");
    await page.getByText("checkout.yaml").hover();
    await page.getByRole("button", { name: "Delete checkout.yaml" }).click();
    await expect.poll(async () => (await app.calls("plugin:fs|remove")).length).toBe(1);
    expect(await app.file(`${WS}/checkout.yaml`)).toBeUndefined();
  });

  test("reopens the last file on the next launch", async ({ app }) => {
    await app.launch({
      ...withWorkspace,
      storage: {
        "maestro-deck.workspace": JSON.stringify({
          state: { folderPath: WS, expanded: {}, lastOpenFile: `${WS}/auth/login.yaml` },
          version: 0,
        }),
      },
    });
    await expect(editor(app)).toContainText("Welcome");
    expect(LOGIN_FLOW).toContain("Welcome");
  });

  test("a folder that can't be read shows the error", async ({ app, page }) => {
    await app.launch({ ...withWorkspace, failures: { list_workspace: "permission denied" } });
    await expect(page.getByText("permission denied")).toBeVisible();
  });
});

test.describe("workspace operations", () => {
  const tree = (app: App) => app.page.getByRole("list").first();

  async function contextAction(app: App, entry: string, action: string) {
    await app.page.getByRole("button", { name: entry, exact: true }).click({ button: "right" });
    await app.page.getByRole("menuitem", { name: action }).click();
  }

  test("renames a flow from its context menu", async ({ app, page }) => {
    await app.launch(withWorkspace);
    await contextAction(app, "checkout.yaml", "Rename");
    const input = page.locator("input[placeholder='flow-name.yaml']");
    await expect(input).toHaveValue("checkout.yaml");
    await page.keyboard.type("cart");
    await page.keyboard.press("Enter");
    await expect(tree(app).getByRole("button", { name: "cart.yaml" })).toBeVisible();
    await expect(tree(app).getByRole("button", { name: "checkout.yaml" })).toHaveCount(0);
    expect(await app.file(`${WS}/cart.yaml`)).toBe(CHECKOUT_FLOW);
    expect(await app.file(`${WS}/checkout.yaml`)).toBeUndefined();
  });

  test("renaming the open flow keeps the editor saving to it", async ({ app, page }) => {
    await app.launch(withWorkspace);
    await page.getByText("checkout.yaml").click();
    await expect(editor(app)).toContainText("Cart");
    await contextAction(app, "checkout.yaml", "Rename");
    await page.keyboard.type("cart");
    await page.keyboard.press("Enter");
    await expect(tree(app).getByRole("button", { name: "cart.yaml" })).toBeVisible();
    await typeAtEnd(app, "- back");
    await expect
      .poll(() => app.file(`${WS}/cart.yaml`), { timeout: 5000 })
      .toBe(`${CHECKOUT_FLOW}- back`);
    expect(await app.file(`${WS}/checkout.yaml`)).toBeUndefined();
  });

  test("renaming a folder follows the open flow inside it", async ({ app, page }) => {
    await app.launch(withWorkspace);
    await page.getByText("login.yaml").click();
    await expect(editor(app)).toContainText("Welcome");
    await contextAction(app, "auth", "Rename");
    const input = page.locator("input[placeholder='folder-name']");
    await input.fill("account");
    await input.press("Enter");
    await expect(tree(app).getByRole("button", { name: "account" })).toBeVisible();
    await typeAtEnd(app, "- back");
    await expect
      .poll(() => app.file(`${WS}/account/login.yaml`), { timeout: 5000 })
      .toBe(`${LOGIN_FLOW}- back`);
    expect(await app.file(`${WS}/auth/login.yaml`)).toBeUndefined();
  });

  test("refuses a name that is taken or not a file name", async ({ app, page }) => {
    await app.launch(withWorkspace);
    await contextAction(app, "login.yaml", "Rename");
    await page.keyboard.type("../checkout");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Invalid name")).toBeVisible();

    await contextAction(app, "checkout.yaml", "Rename");
    await page.keyboard.type("checkout");
    await page.keyboard.press("Enter");
    expect(await app.calls("plugin:fs|rename")).toHaveLength(0);

    await app.respond("plugin:fs|exists", true);
    await contextAction(app, "checkout.yaml", "Rename");
    await page.keyboard.type("login");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Already exists")).toBeVisible();
    expect(await app.calls("plugin:fs|rename")).toHaveLength(0);
    expect(await app.file(`${WS}/checkout.yaml`)).toBe(CHECKOUT_FLOW);
  });

  test("creates a folder, then a flow inside it", async ({ app, page }) => {
    await app.launch(withWorkspace);
    await page.getByRole("button", { name: "New folder", exact: true }).click();
    await page.locator("input[placeholder='folder-name']").fill("payments");
    await page.keyboard.press("Enter");
    await expect(tree(app).getByRole("button", { name: "payments" })).toBeVisible();
    expect((await app.calls("plugin:fs|mkdir"))[0].args).toMatchObject({ path: `${WS}/payments` });

    await page.getByRole("button", { name: "payments" }).hover();
    await page.getByRole("button", { name: "New flow in payments" }).click();
    await page.locator("input[placeholder='flow-name.yaml']").fill("refund.yml");
    await page.keyboard.press("Enter");
    await expect.poll(() => app.file(`${WS}/payments/refund.yml`)).toContain("launchApp");
    await expect(tree(app).getByRole("button", { name: "refund.yml" })).toBeVisible();
    await expect(editor(app)).toContainText("launchApp");
  });

  test("Escape cancels a new entry", async ({ app, page }) => {
    await app.launch(withWorkspace);
    await page.getByRole("button", { name: "New flow", exact: true }).click();
    await page.locator("input[placeholder='flow-name.yaml']").fill("draft");
    await page.keyboard.press("Escape");
    await expect(page.locator("input[placeholder='flow-name.yaml']")).toHaveCount(0);
    expect(await app.file(`${WS}/draft.yaml`)).toBeUndefined();
  });

  test("deleting a folder warns about its contents and closes the flow open in it", async ({
    app,
    page,
  }) => {
    await app.launch(withWorkspace);
    await page.getByText("login.yaml").click();
    await expect(editor(app)).toContainText("Welcome");
    await app.answerDialogs("message", "Delete");
    await contextAction(app, "auth", "Delete");
    const [ask] = await app.waitForCall("plugin:dialog|message");
    expect(JSON.stringify(ask.args)).toContain('Delete folder \\"auth\\" and all its contents?');
    await expect(tree(app).getByRole("button", { name: "auth", exact: true })).toHaveCount(0);
    expect(await app.file(`${WS}/auth/login.yaml`)).toBeUndefined();
    await expect(editor(app)).not.toContainText("Welcome");
  });

  test("a cancelled delete keeps everything", async ({ app }) => {
    await app.launch(withWorkspace);
    await app.answerDialogs("message", "Cancel");
    await contextAction(app, "checkout.yaml", "Delete");
    await app.waitForCall("plugin:dialog|message");
    expect(await app.calls("plugin:fs|remove")).toHaveLength(0);
    await expect(tree(app).getByRole("button", { name: "checkout.yaml" })).toBeVisible();
  });

  test("Refresh picks up flows added outside the app", async ({ app, page }) => {
    await app.launch(withWorkspace);
    await expect(page.getByText("checkout.yaml")).toBeVisible();
    await page.evaluate((ws) => {
      (
        window as unknown as { __e2e: { state: { files: Record<string, string> } } }
      ).__e2e.state.files[`${ws}/onboarding.yaml`] = "appId: x\n---\n- launchApp\n";
    }, WS);
    await page.getByRole("button", { name: "Refresh workspace" }).click();
    await expect(page.getByText("onboarding.yaml")).toBeVisible();
  });

  test("Close workspace goes back to the empty state and is remembered", async ({ app, page }) => {
    await app.launch(withWorkspace);
    await page.getByRole("button", { name: "Close workspace" }).click();
    await expect(page.getByText("No folder open")).toBeVisible();
    const saved = await page.evaluate(() => localStorage.getItem("maestro-deck.workspace"));
    expect(JSON.parse(saved!).state.folderPath).toBeNull();
  });

  test("a config.yaml is flagged as driving the flow order", async ({ app, page }) => {
    await app.launch({
      ...withWorkspace,
      files: { ...WORKSPACE_FILES, [`${WS}/config.yaml`]: "flows:\n  - auth/*\n" },
    });
    await expect(
      page.getByTitle("config.yaml found — Maestro will follow its flows order"),
    ).toBeVisible();
  });

  test("folders remember being expanded", async ({ app, page }) => {
    await app.launch(withWorkspace);
    await page.getByRole("button", { name: "auth", exact: true }).click();
    await expect(page.getByText("login.yaml")).toBeHidden();
    const saved = await page.evaluate(() => localStorage.getItem("maestro-deck.workspace"));
    expect(JSON.parse(saved!).state.expanded[`${WS}/auth`]).toBe(false);
  });
});
