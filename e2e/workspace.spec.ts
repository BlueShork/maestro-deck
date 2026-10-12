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
