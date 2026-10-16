import { expect, test, type App } from "./support/app";

const check = (
  id: string,
  status: string,
  version: string | null = null,
  detail: string | null = null,
) => ({
  id,
  status,
  version,
  detail,
});

const MISSING = {
  checks: [
    check("maestro", "missing"),
    check("java", "ok", "21.0.2"),
    check("adb", "ok", "35.0.1"),
    check("xcode", "missing"),
  ],
  minimalOk: false,
};

const READY = {
  checks: [
    check("maestro", "ok", "2.10.0"),
    check("java", "ok", "21.0.2"),
    check("adb", "ok", "35.0.1"),
    check("xcode", "missing"),
  ],
  minimalOk: true,
};

const popup = (app: App) => app.page.locator("[data-setup-popup]");

test.describe("toolchain setup", () => {
  test("missing tools are set up on their own, with progress, then the popup goes", async ({
    app,
    page,
  }) => {
    await app.launch({ responses: { environment_status: MISSING }, deferred: ["setup_tools"] });
    await expect(popup(app).getByText("Setup required")).toBeVisible();
    await expect(popup(app).getByText("maestro CLI 2.10.0")).toBeVisible();
    await expect(popup(app).getByText("Platforms (optional)")).toBeVisible();
    await app.waitForCall("setup_tools");
    await expect(page.getByRole("button", { name: /^Run$/ })).toBeDisabled();

    await app.emit("setup:progress", {
      tool: "maestro",
      label: "Maestro CLI",
      phase: "download",
      percent: 42,
    });
    await expect(page.getByRole("button", { name: "Setting up — Maestro CLI 42%" })).toBeVisible();
    await app.emit("setup:done", { tool: "maestro", label: "Maestro CLI", ok: true, error: null });
    await app.respond("environment_status", READY);
    await app.settle("setup_tools");

    await expect(popup(app).getByText("Environment ready")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Run$/ })).toBeEnabled();
    await expect(popup(app)).toHaveCount(0, { timeout: 4000 });
    const saved = await page.evaluate(() => localStorage.getItem("maestro-deck.env"));
    expect(JSON.parse(saved!).state.dismissedForever).toBe(true);
  });

  test("a failed automatic setup turns the chip red, and a manual install recovers", async ({
    app,
    page,
  }) => {
    await app.launch({
      responses: { environment_status: MISSING },
      deferred: ["setup_tools", "install_tool"],
    });
    await app.waitForCall("setup_tools");
    await app.emit("setup:done", {
      tool: "maestro",
      label: "Maestro CLI",
      ok: false,
      error: "checksum mismatch",
    });
    await app.settle("setup_tools");
    const chip = page.getByRole("button", { name: "Setup failed — Maestro CLI" });
    await expect(chip).toBeVisible();

    await popup(app).getByLabel("Collapse").click();
    await expect(popup(app).getByText("Setup incomplete (1/2)")).toBeVisible();
    await chip.click();
    await expect(popup(app).getByText("Setup required")).toBeVisible();

    await popup(app).getByRole("button", { name: "Install", exact: true }).click();
    const [install] = await app.waitForCall("install_tool");
    expect(install.args).toEqual({ id: "maestro" });
    await app.emit("env:install:output", { id: "maestro", line: "Downloading maestro 2.10.0…" });
    await expect(popup(app).getByText("Downloading maestro 2.10.0…")).toBeVisible();
    await app.settle("install_tool", null, "curl: (6) Could not resolve host");
    await expect(
      popup(app).getByText("Install failed — curl: (6) Could not resolve host"),
    ).toBeVisible();

    await popup(app).getByRole("button", { name: "Install", exact: true }).click();
    await app.respond("environment_status", READY);
    await app.emit("setup:done", { tool: "maestro", label: "Maestro CLI", ok: true, error: null });
    await app.settle("install_tool");
    await expect(popup(app).getByText("Environment ready")).toBeVisible();
    await expect(chip).toBeHidden();
  });

  test("Re-check asks the backend again", async ({ app, page }) => {
    await app.launch({ responses: { environment_status: MISSING }, deferred: ["setup_tools"] });
    await expect(popup(app).getByText("Setup required")).toBeVisible();
    const before = (await app.calls("environment_status")).length;
    await app.respond("environment_status", READY);
    await popup(app).getByRole("button", { name: "Re-check" }).click();
    await expect(popup(app).getByText("Environment ready")).toBeVisible();
    expect((await app.calls("environment_status")).length).toBe(before + 1);
    await expect(page.getByRole("button", { name: /^Run$/ })).toBeEnabled();
  });

  test("a wrong version says what it found", async ({ app }) => {
    await app.launch({
      responses: {
        environment_status: {
          checks: [
            check("maestro", "wrong-version", "1.39.0", "needs 2.10.0"),
            check("java", "ok", "21"),
          ],
          minimalOk: false,
        },
      },
      deferred: ["setup_tools"],
    });
    await expect(popup(app).getByText("— 1.39.0")).toBeVisible();
    await expect(popup(app).getByText("(needs 2.10.0)")).toBeVisible();
  });

  test("a set-up machine never sees the popup", async ({ app, page }) => {
    await app.launch();
    await page.waitForTimeout(300);
    await expect(popup(app)).toHaveCount(0);
    expect(await app.calls("setup_tools")).toHaveLength(0);
  });
});
