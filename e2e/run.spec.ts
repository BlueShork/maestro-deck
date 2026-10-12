import { expect, test, type App } from "./support/app";
import { FAILING_RUN, PASSING_RUN, PIXEL, WS, withWorkspace } from "./support/data";

const connected = {
  ...withWorkspace,
  devices: [PIXEL],
  storage: {
    ...withWorkspace.storage,
    "maestro-deck.workspace": JSON.stringify({
      state: { folderPath: WS, expanded: {}, lastOpenFile: `${WS}/auth/login.yaml` },
      version: 0,
    }),
  },
};

async function startRun(app: App) {
  await expect(app.page.locator(".cm-content")).toContainText("Welcome");
  await app.page.getByRole("button", { name: /^Run$/ }).click();
  await app.waitForCall("run_flow");
}

async function stream(app: App, lines: string[]) {
  for (const line of lines) await app.emit("runner:stdout", line);
}

const console$ = (app: App) => app.page.locator("section").filter({ hasText: "Console" }).last();
/** Step rows of the Simple console view, by state. */
const stepRows = (app: App, state: "done" | "running" | "failed") =>
  console$(app).locator(`div.border-l-2 .step-pip-${state}`);

test.describe("running a flow", () => {
  test("runs the open file and shows each step pass", async ({ app, page }) => {
    await app.launch(connected);
    await startRun(app);
    const [call] = await app.calls("run_flow");
    expect(call.args).toMatchObject({ filePath: `${WS}/auth/login.yaml` });
    await expect(page.getByRole("button", { name: /^Stop$/ })).toBeVisible();

    await stream(app, PASSING_RUN);
    await app.emit("runner:exit", { pid: 4242, code: 0 });

    await expect(page.getByText("Test passed")).toBeVisible();
    await expect(page.getByText("4 steps in", { exact: false })).toBeVisible();
    await expect(stepRows(app, "done")).toHaveCount(4);
    await expect(page.getByText("Flow completed")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Run$/ })).toBeVisible();
  });

  test("a failing step is marked with Maestro's message", async ({ app, page }) => {
    await app.launch(connected);
    await startRun(app);
    await stream(app, FAILING_RUN);
    await app.emit("runner:exit", { pid: 4242, code: 1 });

    await expect(page.getByText("Test failed")).toBeVisible();
    await expect(page.getByText("at step 4")).toBeVisible();
    await expect(page.getByTitle('Assertion is false: "Welcome" is visible')).toBeVisible();
    await expect(page.getByText("exit code 1")).toBeVisible();
  });

  test("the step being executed is highlighted while the run is live", async ({ app, page }) => {
    await app.launch(connected);
    await startRun(app);
    await stream(app, PASSING_RUN.slice(0, 3));
    await expect(stepRows(app, "done")).toHaveCount(1);
    await expect(stepRows(app, "running")).toHaveCount(1);
    await expect(page.locator(".cm-lineNumbers .cm-step-line-done")).toHaveCount(1);
  });

  test("Stop asks the backend to kill the runner and says the flow stopped", async ({
    app,
    page,
  }) => {
    await app.launch(connected);
    await startRun(app);
    await page.getByRole("button", { name: /^Stop$/ }).click();
    const [stop] = await app.waitForCall("stop_flow");
    expect(stop.args).toEqual({ pid: 4242 });
    await app.emit("runner:exit", { pid: 4242, code: null });
    await expect(page.getByText("Test stopped")).toBeVisible();
    await expect(page.getByText("Flow stopped")).toBeVisible();
  });

  test("the technical view shows the raw output, stderr in red", async ({ app, page }) => {
    await app.launch(connected);
    await startRun(app);
    await page.getByRole("button", { name: "Technical" }).click();
    await stream(app, PASSING_RUN);
    await app.emit("runner:stderr", "warning: device is slow");
    await app.emit("runner:exit", { pid: 4242, code: 0 });
    await expect(page.getByText("[runner started pid 4242", { exact: false })).toBeVisible();
    await expect(page.getByText('Tap on "Login"... COMPLETED')).toBeVisible();
    await expect(page.getByText("warning: device is slow").locator("..")).toHaveClass(
      /text-destructive/,
    );
    await expect(page.getByText("[runner exited with code 0]")).toBeVisible();
  });

  test("a start failure resets the toolbar and reports it", async ({ app, page }) => {
    await app.launch({ ...connected, failures: { run_flow: "maestro not found on PATH" } });
    await expect(page.locator(".cm-content")).toContainText("Welcome");
    await page.getByRole("button", { name: /^Run$/ }).click();
    await expect(page.getByText("maestro not found on PATH")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Run$/ })).toBeEnabled();
  });

  test("an untitled buffer runs from a temp copy", async ({ app, page }) => {
    await app.launch({ devices: [PIXEL] });
    await page.getByRole("button", { name: /^Run$/ }).click();
    const [call] = await app.waitForCall("run_flow");
    expect(call.args).toMatchObject({ filePath: "/tmp/maestro-deck-flow.yaml" });
    expect(await app.file("/tmp/maestro-deck-flow.yaml")).toContain("launchApp");
  });

  test("Run all runs the whole folder, driving only the open flow's steps", async ({
    app,
    page,
  }) => {
    await app.launch(connected);
    await expect(page.locator(".cm-content")).toContainText("Welcome");
    await page.getByRole("button", { name: /Run all/ }).click();
    const [call] = await app.waitForCall("run_flow");
    expect(call.args).toMatchObject({ filePath: WS });
    await stream(app, [" > Flow checkout", 'Launch app "com.example.app"... COMPLETED']);
    await expect(stepRows(app, "done")).toHaveCount(0);
    await stream(app, PASSING_RUN.slice(1));
    await expect(stepRows(app, "done")).toHaveCount(4);
  });

  test("Run all is disabled without a workspace", async ({ app, page }) => {
    await app.launch();
    await expect(page.getByRole("button", { name: /Run all/ })).toBeDisabled();
  });
});
