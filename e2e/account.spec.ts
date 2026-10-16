import { expect, test, type App } from "./support/app";
import { fakeCloud, FREE_BILLING, signIn } from "./support/cloud";
import { PIXEL, WS, withWorkspace } from "./support/data";
import { fakeHostedBilly } from "./support/llm";

async function fillLogin(app: App, email: string, password: string) {
  await app.page.getByPlaceholder("you@example.com").fill(email);
  await app.page.getByPlaceholder("At least 6 characters").fill(password);
}

test.describe("account", () => {
  test("signs in, shows the balance and the plan, then signs out", async ({ app, page }) => {
    const cloud = await fakeCloud(page, {
      billing: { ...FREE_BILLING, runsRemaining: 17, runsToday: 3, dailyCap: 10 },
    });
    await app.launch();
    await page.goto("/#/account");
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
    await fillLogin(app, "  me@example.com ", "hunter22");
    await page.getByRole("button", { name: "Continue with email" }).click();

    await expect(page.getByText("me@example.com").first()).toBeVisible();
    const runsLeft = page.getByText("Runs remaining").locator("..");
    await expect(runsLeft).toContainText("17");
    await expect(page.getByText("3/10")).toBeVisible();
    await expect(page.getByText("7 left today")).toBeVisible();
    expect(cloud.hits()).toContain("GET /api/billing/me");
    expect(cloud.lastAuth()).toMatch(/^Bearer ey/);
    await page.goto("/#/");
    await expect(page.getByRole("button", { name: "Plan: Free Tier" })).toBeVisible();

    await page.goto("/#/account");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
    await page.goto("/#/");
    await expect(page.getByRole("button", { name: "Sign in to Maestro Deck Cloud" })).toBeVisible();
  });

  test("a wrong password is explained, and the form stays usable", async ({ app, page }) => {
    await fakeCloud(page);
    await app.launch();
    await page.goto("/#/account");
    await fillLogin(app, "me@example.com", "wrong-pass");
    await page.getByRole("button", { name: "Continue with email" }).click();
    await expect(page.getByText("The email or password is incorrect.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with email" })).toBeEnabled();
  });

  test("creates an account, refusing an email that already has one", async ({ app, page }) => {
    await fakeCloud(page);
    await app.launch();
    await page.goto("/#/account");
    await page.getByRole("button", { name: "Create an account" }).first().click();
    await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();

    await fillLogin(app, "me@example.com", "whatever1");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(/This email already has an account/)).toBeVisible();

    await fillLogin(app, "new@example.com", "s3cret!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Signed in to Maestro Deck Cloud")).toBeVisible();
    await expect(page.getByText("new@example.com").first()).toBeVisible();
  });

  test("a paid pack shows its name, renewal and live device minutes", async ({ app, page }) => {
    await fakeCloud(page, {
      billing: {
        tier: "indie",
        runsRemaining: 480,
        sessionMinutesRemaining: 4,
        runsToday: 10,
        dailyCap: 10,
        currentPack: { id: "indie", displayName: "Indie" },
        expiresAt: "2026-12-01T00:00:00Z",
      },
    });
    await app.launch();
    await signIn(app);
    await expect(page.getByRole("button", { name: "Plan: Indie" })).toBeVisible();
    await page.goto("/#/account");
    await expect(page.getByText(/renews/)).toBeVisible();
    await expect(page.getByText("Daily limit reached")).toBeVisible();
    await expect(page.getByText("Live device minutes")).toBeVisible();
    await expect(page.getByText("/ 60 min")).toBeVisible();
  });

  test("a balance that can't load offers a retry that recovers", async ({ app, page }) => {
    const cloud = await fakeCloud(page, { billing: { status: 500 } });
    await app.launch();
    await signIn(app);
    await page.goto("/#/account");
    await expect(page.getByText("Couldn't reach your account")).toBeVisible();
    await expect(page.getByText(/HTTP 500/)).toBeVisible();
    cloud.setBilling({ ...FREE_BILLING, runsRemaining: 5 });
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Runs remaining").locator("..")).toContainText("5");
    await expect(page.getByText("Couldn't reach your account")).toBeHidden();
  });

  test("Buy more runs opens the billing page in the browser", async ({ app, page }) => {
    await fakeCloud(page);
    await app.launch();
    await signIn(app);
    await page.goto("/#/account");
    await page.getByRole("button", { name: "Buy more runs" }).click();
    const [open] = await app.waitForCall("plugin:opener|open_url");
    expect(open.args).toMatchObject({ url: "https://dashboard.maestrodeck.cloud/billing" });
  });

  test("Escape leaves the account page", async ({ app, page }) => {
    await app.launch();
    await page.goto("/#/account");
    await page.getByRole("heading", { name: "Log in" }).click();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/#\/$/);
  });
});

test.describe("hosted Billy", () => {
  const opened = {
    ...withWorkspace,
    storage: {
      ...withWorkspace.storage,
      "maestro-deck.workspace": JSON.stringify({
        state: { folderPath: WS, expanded: {}, lastOpenFile: `${WS}/checkout.yaml` },
        version: 0,
      }),
    },
  };

  test("answers through the account, with the session token and tools", async ({ app, page }) => {
    const cloud = await fakeCloud(page);
    const billy = await fakeHostedBilly(page, [
      { tools: [{ id: "c1", name: "read_flow", input: { path: "checkout.yaml" } }] },
      { text: "It opens the **Cart**." },
    ]);
    await app.launch(opened);
    await signIn(app);
    await page.getByRole("button", { name: "Toggle AI assistant" }).click();
    await page.getByPlaceholder("Message Billy…").fill("What does checkout do?");
    await page.getByPlaceholder("Message Billy…").press("Enter");

    await expect(page.locator("strong", { hasText: "Cart" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Lit checkout\.yaml/ }).getByLabel("Succès"),
    ).toBeVisible();
    expect(cloud.lastAuth()).toMatch(/^Bearer ey/);
    const second = billy.requests()[1].messages as Array<Record<string, unknown>>;
    const call = second.find((m) => m.role === "assistant")!.tool_calls as Array<{ id: string }>;
    const tool = second.find((m) => m.role === "tool")!;
    expect(tool.tool_call_id).toBe(call[0].id);
    expect(String(tool.content)).toContain('tapOn: "Cart"');
    await expect(page.getByRole("button", { name: "Read aloud" }).first()).toBeVisible();
  });

  test("an expired session tells the user what to do", async ({ app, page }) => {
    await fakeCloud(page);
    await fakeHostedBilly(page, [{ status: 401, body: "{}" }]);
    await app.launch(opened);
    await signIn(app);
    await page.getByRole("button", { name: "Toggle AI assistant" }).click();
    await page.getByPlaceholder("Message Billy…").fill("hi");
    await page.getByPlaceholder("Message Billy…").press("Enter");
    await expect(
      page.getByText("Your Maestro Deck session expired — sign out and back in."),
    ).toBeVisible();
  });

  test("a server error shows the server's own message", async ({ app, page }) => {
    await fakeCloud(page);
    await fakeHostedBilly(page, [{ status: 429, body: '{"error":"Daily Billy limit reached"}' }]);
    await app.launch(opened);
    await signIn(app);
    await page.getByRole("button", { name: "Toggle AI assistant" }).click();
    await page.getByPlaceholder("Message Billy…").fill("hi");
    await page.getByPlaceholder("Message Billy…").press("Enter");
    await expect(page.getByText("Daily Billy limit reached")).toBeVisible();
  });

  test("Billy settings show the account and switch the chat back to it", async ({ app, page }) => {
    await fakeCloud(page);
    await app.launch({
      storage: {
        "maestro-deck.chat": JSON.stringify({
          state: { currentProvider: "anthropic", currentModel: "claude-sonnet-4-5" },
          version: 0,
        }),
      },
    });
    await signIn(app);
    await page.goto("/#/settings/ai");
    await page
      .getByRole("group", { name: "Provider" })
      .getByRole("button", { name: "Maestro Deck" })
      .click();
    await expect(page.getByText("Signed in as")).toContainText("me@example.com");
    await page.getByRole("button", { name: "Use in the chat" }).click();
    await expect(page.getByRole("button", { name: "Used by the chat" })).toBeDisabled();
    const saved = await page.evaluate(() => localStorage.getItem("maestro-deck.chat"));
    expect(JSON.parse(saved!).state.currentProvider).toBe("maestrodeck");
  });
});

test.describe("cloud invite", () => {
  const invited = {
    ...withWorkspace,
    devices: [PIXEL],
    storage: {
      ...withWorkspace.storage,
      "maestro-deck.cloud-invite": JSON.stringify({ state: { asked: false }, version: 0 }),
      "maestro-deck.workspace": JSON.stringify({
        state: { folderPath: WS, expanded: {}, lastOpenFile: `${WS}/checkout.yaml` },
        version: 0,
      }),
    },
  };

  async function passRun(app: App) {
    await expect(app.page.locator(".cm-content")).toContainText("Cart");
    await app.page.getByRole("button", { name: /^Run$/ }).click();
    await app.waitForCall("run_flow");
    await app.emit("runner:exit", { pid: 4242, code: 0 });
  }

  test("a first passing run without an account offers one, once", async ({ app, page }) => {
    await app.launch(invited);
    await passRun(app);
    const invite = page.getByRole("dialog").filter({ hasText: "Run that flow on real devices" });
    await expect(invite).toBeVisible();
    await invite.getByRole("button", { name: "Create free account" }).click();
    await expect(page).toHaveURL(/#\/account$/);

    await page.goto("/#/");
    await passRun(app);
    await page.waitForTimeout(2000);
    await expect(invite).toHaveCount(0);
  });

  test("Not now dismisses it, and a failed run never triggers it", async ({ app, page }) => {
    await app.launch(invited);
    await expect(page.locator(".cm-content")).toContainText("Cart");
    await page.getByRole("button", { name: /^Run$/ }).click();
    await app.waitForCall("run_flow");
    await app.emit("runner:exit", { pid: 4242, code: 1 });
    await page.waitForTimeout(2000);
    const invite = page.getByRole("dialog").filter({ hasText: "Run that flow on real devices" });
    await expect(invite).toHaveCount(0);

    await page.getByRole("button", { name: /^Run$/ }).click();
    await app.emit("runner:exit", { pid: 4242, code: 0 });
    await invite.getByRole("button", { name: "Not now" }).click();
    await expect(invite).toHaveCount(0);
    await expect(page).toHaveURL(/#\/$/);
  });

  test("signed-in users are not invited", async ({ app, page }) => {
    await fakeCloud(page);
    await app.launch(invited);
    await signIn(app);
    await passRun(app);
    await page.waitForTimeout(2000);
    await expect(page.getByText("Run that flow on real devices")).toHaveCount(0);
  });
});
