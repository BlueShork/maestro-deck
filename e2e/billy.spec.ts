import { expect, test, type App } from "./support/app";
import {
  FAILING_RUN,
  HIERARCHY,
  IPHONE_SIM,
  LOGIN_FLOW,
  WS,
  screenPng,
  withWorkspace,
} from "./support/data";
import { fakeAnthropic, withAnthropic } from "./support/llm";

const ready = {
  ...withWorkspace,
  credentials: withAnthropic.credentials,
  storage: {
    ...withWorkspace.storage,
    ...withAnthropic.storage,
    "maestro-deck.workspace": JSON.stringify({
      state: { folderPath: WS, expanded: {}, lastOpenFile: `${WS}/auth/login.yaml` },
      version: 0,
    }),
  },
};

const input = (app: App) => app.page.getByPlaceholder("Message Billy…");
const editor = (app: App) => app.page.locator(".cm-content");

async function openBilly(app: App) {
  await expect(editor(app)).toContainText("Welcome");
  await app.page.getByRole("button", { name: "Toggle AI assistant" }).click();
  await expect(input(app)).toBeVisible();
}

async function ask(app: App, text: string) {
  await input(app).fill(text);
  await input(app).press("Enter");
}

function toolResults(body: Record<string, unknown>) {
  const msgs = body.messages as Array<{ role: string; content: unknown }>;
  return msgs.flatMap((m) =>
    Array.isArray(m.content)
      ? (m.content as Array<Record<string, unknown>>).filter((b) => b.type === "tool_result")
      : [],
  );
}

const flat = (content: unknown) =>
  typeof content === "string" ? content : JSON.stringify(content);

test.describe("Billy, answering", () => {
  test("streams the answer as markdown and sends the key, prompt and editor context", async ({
    app,
    page,
  }) => {
    const server = await fakeAnthropic(page, [
      { text: "The flow logs in, then checks **Welcome** is shown." },
    ]);
    await app.launch(ready);
    await openBilly(app);
    await ask(app, "What does this flow do?");

    await expect(page.getByText("What does this flow do?")).toBeVisible();
    await expect(page.locator("strong", { hasText: "Welcome" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

    const [body] = server.requests();
    expect(body.model).toBe("claude-sonnet-4-5");
    const system = JSON.stringify(body.system);
    expect(system).toContain(`${WS}/auth/login.yaml`);
    expect(system).toContain('assertVisible: \\"Welcome\\"');
    expect(system).toContain("- checkout.yaml");
    expect(system).toContain("- auth/login.yaml");
    expect(body.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "write_flow" })]),
    );
    const msgs = body.messages as Array<{ role: string; content: unknown }>;
    expect(msgs.at(-1)).toMatchObject({ role: "user" });
    expect(flat(msgs.at(-1)!.content)).toContain("What does this flow do?");
  });

  test("the earlier turns are sent again with a follow-up", async ({ app, page }) => {
    const server = await fakeAnthropic(page, [{ text: "First answer." }, { text: "Second." }]);
    await app.launch(ready);
    await openBilly(app);
    await ask(app, "one");
    await expect(page.getByText("First answer.")).toBeVisible();
    await ask(app, "two");
    await expect(page.getByText("Second.")).toBeVisible();
    const second = server.requests()[1].messages as Array<{ role: string; content: unknown }>;
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(flat(second[1].content)).toContain("First answer.");
  });

  test("an API error is shown and the empty answer is dropped", async ({ app, page }) => {
    await fakeAnthropic(page, [{ status: 401, body: '{"error":{"message":"invalid x-api-key"}}' }]);
    await app.launch(ready);
    await openBilly(app);
    await ask(app, "hello");
    await expect(page.getByText(/Anthropic 401: .*invalid x-api-key/)).toBeVisible();
    await expect(page.getByText("Billy", { exact: true })).toHaveCount(1);
    await expect(input(app)).toBeEnabled();
  });

  test("Stop interrupts a pending answer and marks it stopped", async ({ app, page }) => {
    await fakeAnthropic(page, ["hang"]);
    await app.launch(ready);
    await openBilly(app);
    await ask(app, "take your time");
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByText("[stopped]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop" })).toBeHidden();
  });

  test("Clear conversation empties the panel", async ({ app, page }) => {
    await fakeAnthropic(page, [{ text: "Hi there." }]);
    await app.launch(ready);
    await openBilly(app);
    await ask(app, "hello");
    await expect(page.getByText("Hi there.")).toBeVisible();
    await page.getByRole("button", { name: "Clear conversation" }).click();
    await expect(page.getByText("Hi there.")).toBeHidden();
    await expect(page.getByText("hello", { exact: true })).toBeHidden();
  });

  test("hosted Billy without an account asks to sign in, and sends nothing", async ({
    app,
    page,
  }) => {
    let hit = false;
    await page.route("https://dashboard.maestrodeck.cloud/api/assistant/agent", (r) => {
      hit = true;
      return r.abort();
    });
    await app.launch(withWorkspace);
    await page.getByRole("button", { name: "Toggle AI assistant" }).click();
    await ask(app, "hello");
    await expect(page.getByText(/Sign in to your Maestro Deck account to use Billy/)).toBeVisible();
    expect(hit).toBe(false);
  });

  test("the model picker switches provider and model, and remembers it", async ({ app, page }) => {
    const server = await fakeAnthropic(page, [{ text: "ok" }]);
    await app.launch({ ...withWorkspace, credentials: withAnthropic.credentials });
    await page.getByRole("button", { name: "Toggle AI assistant" }).click();
    await page.getByRole("button", { name: /Maestro Deck · Billy/ }).click();
    await page.getByRole("menuitem", { name: "Claude Opus 4.5 (latest)" }).click();
    await expect(page.getByRole("button", { name: /Anthropic · Claude Opus 4.5/ })).toBeVisible();
    await ask(app, "hello");
    await expect(page.getByText("ok", { exact: true })).toBeVisible();
    expect(server.requests()[0].model).toBe("claude-opus-4-5");
    const saved = await page.evaluate(() => localStorage.getItem("maestro-deck.chat"));
    expect(JSON.parse(saved!).state).toMatchObject({
      currentProvider: "anthropic",
      currentModel: "claude-opus-4-5",
    });
  });
});

test.describe("Billy, tools", () => {
  test("write_flow rewrites the open flow on disk and in the editor", async ({ app, page }) => {
    const updated = LOGIN_FLOW.replace('"Welcome"', '"Home"');
    const server = await fakeAnthropic(page, [
      {
        text: "Fixing the assertion.",
        tools: [
          { id: "t1", name: "write_flow", input: { path: "auth/login.yaml", content: updated } },
        ],
      },
      { text: "Done, it now checks Home." },
    ]);
    await app.launch(ready);
    await openBilly(app);
    await ask(app, "Check Home instead");

    await expect(page.getByText("Done, it now checks Home.")).toBeVisible();
    expect(await app.file(`${WS}/auth/login.yaml`)).toBe(updated);
    await expect(editor(app)).toContainText('assertVisible: "Home"');
    const card = page.getByRole("button", { name: /Écrit auth\/login\.yaml/ });
    await expect(card.getByLabel("Succès")).toBeVisible();
    await card.click();
    await expect(page.getByText('- assertVisible: "Home"').first()).toBeVisible();

    const [result] = toolResults(server.requests()[1]);
    expect(result).toMatchObject({ tool_use_id: "t1" });
    expect(flat(result.content)).toContain("written");
  });

  test("a failing tool is shown as an error and its message goes back to the model", async ({
    app,
    page,
  }) => {
    const server = await fakeAnthropic(page, [
      { tools: [{ id: "t1", name: "read_flow", input: { path: "missing.yaml" } }] },
      { text: "That file doesn't exist." },
    ]);
    await app.launch(ready);
    await openBilly(app);
    await ask(app, "Read missing.yaml");
    await expect(page.getByText("That file doesn't exist.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Lit missing\.yaml/ }).getByLabel("Erreur"),
    ).toBeVisible();
    const [result] = toolResults(server.requests()[1]);
    expect(result.is_error).toBe(true);
    expect(flat(result.content)).toContain("no such flow: missing.yaml");
  });

  test("device tools refuse cleanly without a device", async ({ app, page }) => {
    const server = await fakeAnthropic(page, [
      { tools: [{ id: "t1", name: "tap", input: { x: 10, y: 20 } }] },
      { text: "Please connect a device." },
    ]);
    await app.launch(ready);
    await openBilly(app);
    await ask(app, "Tap the button");
    await expect(page.getByText("Please connect a device.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Tap \(10, 20\)/ }).getByLabel("Erreur"),
    ).toBeVisible();
    expect(flat(toolResults(server.requests()[1])[0].content)).toContain("No device connected");
    expect(await app.calls("send_input")).toHaveLength(0);
  });

  test("list_flows answers from the workspace tree", async ({ app, page }) => {
    const server = await fakeAnthropic(page, [
      { tools: [{ id: "t1", name: "list_flows", input: {} }] },
      { text: "You have two flows." },
    ]);
    await app.launch(ready);
    await openBilly(app);
    await ask(app, "What flows do I have?");
    await expect(page.getByText("You have two flows.")).toBeVisible();
    expect(flat(toolResults(server.requests()[1])[0].content)).toContain(
      "auth/login.yaml\ncheckout.yaml",
    );
  });

  test("run_flow runs the flow, waits for the exit, and reports the failing step", async ({
    app,
    page,
  }) => {
    const server = await fakeAnthropic(page, [
      { tools: [{ id: "t1", name: "run_flow", input: { path: "auth/login.yaml" } }] },
      { text: "The Welcome assertion fails." },
    ]);
    await app.launch(ready);
    await openBilly(app);
    await ask(app, "Run the login flow");

    const [run] = await app.waitForCall("run_flow");
    expect(run.args).toMatchObject({ filePath: `${WS}/auth/login.yaml` });
    await expect(page.getByRole("button", { name: /^Stop$/ }).first()).toBeVisible();
    for (const line of FAILING_RUN) await app.emit("runner:stdout", line);
    await app.emit("runner:exit", { pid: 4242, code: 1 });

    await expect(page.getByText("The Welcome assertion fails.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Run auth\/login\.yaml · ✗ exit 1/ }),
    ).toBeVisible();
    const result = JSON.parse(toolResults(server.requests()[1])[0].content as string) as {
      exitCode: number;
      failure: { command: string; error: string };
    };
    expect(result.exitCode).toBe(1);
    expect(result.failure.command).toBe("assertVisible");
    expect(result.failure.error).toContain('"Welcome" is visible');
    await expect(page.getByText("Test failed")).toBeVisible();
  });

  test("run_flow refuses while another run is going", async ({ app, page }) => {
    const server = await fakeAnthropic(page, [
      { tools: [{ id: "t1", name: "run_flow", input: { path: "checkout.yaml" } }] },
      { text: "A run is already going." },
    ]);
    await app.launch({ ...ready, devices: [] });
    await expect(editor(app)).toContainText("Welcome");
    await page.getByRole("button", { name: /^Run$/ }).click();
    await app.waitForCall("run_flow");
    await page.getByRole("button", { name: "Toggle AI assistant" }).click();
    await ask(app, "Run checkout");
    await expect(page.getByText("A run is already going.")).toBeVisible();
    expect(flat(toolResults(server.requests()[1])[0].content)).toContain(
      "A run is already in progress",
    );
    expect(await app.calls("run_flow")).toHaveLength(1);
  });
});

test.describe("Billy, YAML proposals", () => {
  const proposal = LOGIN_FLOW.replace('- inputText: "user@example.com"\n', "");

  test("Apply shows the diff, then replaces the editor content", async ({ app, page }) => {
    await fakeAnthropic(page, [{ text: `Try this:\n\n\`\`\`yaml\n${proposal}\`\`\`\n` }]);
    await app.launch(ready);
    await openBilly(app);
    await ask(app, "Remove the text input");
    await page.getByRole("button", { name: "Apply", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(`Apply changes to ${WS}/auth/login.yaml?`)).toBeVisible();
    await expect(dialog.getByText("+0")).toBeVisible();
    await expect(dialog.getByText("−1")).toBeVisible();
    await expect(dialog.locator("tr.bg-destructive\\/10")).toContainText(
      'inputText: "user@example.com"',
    );

    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toBeHidden();
    await expect(editor(app)).not.toContainText("user@example.com");
    await expect(editor(app)).toContainText("Welcome");
    await expect.poll(() => app.file(`${WS}/auth/login.yaml`)).toBe(proposal);
  });

  test("Cancel leaves the editor untouched", async ({ app, page }) => {
    await fakeAnthropic(page, [{ text: `\`\`\`yaml\n${proposal}\`\`\`` }]);
    await app.launch(ready);
    await openBilly(app);
    await ask(app, "Remove the text input");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(editor(app)).toContainText("user@example.com");
  });

  test("non-YAML code blocks have no Apply button", async ({ app, page }) => {
    await fakeAnthropic(page, [{ text: "```bash\nmaestro test flow.yaml\n```" }]);
    await app.launch(ready);
    await openBilly(app);
    await ask(app, "How do I run it?");
    await expect(page.getByText("maestro test flow.yaml")).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  });
});

test.describe("Billy settings", () => {
  test("an Anthropic key is saved to the keychain, never shown back, and can be cleared", async ({
    app,
    page,
  }) => {
    await app.launch();
    await page.goto("/#/settings/ai");
    await page
      .getByRole("group", { name: "Provider" })
      .getByRole("button", { name: "Anthropic" })
      .click();
    await page.getByPlaceholder("sk-ant-…").fill("sk-ant-secret");
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await expect(page.getByText("Anthropic credentials saved.")).toBeVisible();
    const [save] = await app.calls("save_credential");
    expect(save.args).toEqual({
      provider: "anthropic",
      payload: JSON.stringify({ apiKey: "sk-ant-secret" }),
    });
    await expect(page.getByPlaceholder("sk-ant-…")).not.toHaveValue("sk-ant-secret");

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText("Credentials cleared.")).toBeVisible();
    expect((await app.calls("delete_credential"))[0].args).toEqual({ provider: "anthropic" });
  });

  test("a saved key is reported as saved on the next visit", async ({ app, page }) => {
    await app.launch({ credentials: withAnthropic.credentials, storage: withAnthropic.storage });
    await page.goto("/#/settings/ai");
    await expect(page.getByText("saved", { exact: true })).toBeVisible();
  });

  test("a custom system prompt is what Billy is sent, until reset", async ({ app, page }) => {
    const server = await fakeAnthropic(page, [{ text: "ok" }, { text: "ok again" }]);
    await app.launch(ready);
    await page.goto("/#/settings/ai");
    const prompt = page.getByLabel("Billy system prompt");
    await prompt.fill("You are a terse pirate.");
    await page.getByRole("button", { name: "Save", exact: true }).last().click();
    await expect(page.getByText("Customized")).toBeVisible();

    await page.goto("/#/");
    await openBilly(app);
    await ask(app, "hi");
    await expect(page.getByText("ok", { exact: true })).toBeVisible();
    expect(JSON.stringify(server.requests()[0].system)).toContain("You are a terse pirate.");

    await page.goto("/#/settings/ai");
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByText("Default", { exact: true })).toBeVisible();
    await expect(prompt).not.toHaveValue("You are a terse pirate.");
  });
});

test.describe("Billy, on the device", () => {
  test("reads the screen, inspects, taps, types and drives the app", async ({ app, page }) => {
    const server = await fakeAnthropic(page, [
      {
        text: "Let me look.",
        tools: [
          { id: "s", name: "get_screen", input: {} },
          { id: "i", name: "inspect_element", input: { x: 200, y: 420 } },
          { id: "t", name: "tap", input: { x: 200.6, y: 423.2 } },
          { id: "w", name: "input_text", input: { text: "user@example.com" } },
          { id: "h", name: "press_key", input: { key: "home" } },
          { id: "l", name: "launch_app", input: {} },
          { id: "l2", name: "launch_app", input: { appId: "com.example.app" } },
          { id: "x", name: "stop_app", input: { appId: "com.example.app" } },
          { id: "p", name: "take_screenshot", input: {} },
        ],
      },
      { text: "Logged in." },
    ]);
    await app.launch({
      ...ready,
      devices: [IPHONE_SIM],
      responses: {
        enter_inspect_mode: HIERARCHY,
        query_element: HIERARCHY.root.children[0],
        suggest_selectors: [
          { kind: "resourceId", value: "login_button" },
          { kind: "point", x_pct: 50, y_pct: 48 },
        ],
      },
    });
    await page
      .getByRole("button", { name: /iPhone 16 Pro/ })
      .first()
      .click();
    await expect(page.getByText("Device connected")).toBeVisible();
    await app.emit("ios_frame", { data: screenPng(402, 874), width: 402, height: 874 });
    await expect(page.locator("canvas")).toBeVisible();
    await openBilly(app);
    await ask(app, "Log me in");
    await expect(page.getByText("Logged in.")).toBeVisible();

    const results = Object.fromEntries(
      toolResults(server.requests()[1]).map((r) => [r.tool_use_id as string, r]),
    );
    expect(flat(results.s.content)).toContain(
      'Button text "Log in" id "login_button" bounds [60,393,282,61] clickable',
    );
    expect(flat(results.i.content)).toContain("selectors (best first):");
    expect(flat(results.i.content)).toContain('2. point: "50%, 48%"');
    expect((await app.calls("send_input")).map((c) => c.args)).toEqual([
      { event: { kind: "tap", x: 201, y: 423 }, screenW: 1206, screenH: 2622 },
      { event: { kind: "text", text: "user@example.com" }, screenW: 1206, screenH: 2622 },
    ]);
    await app.waitForCall("ios_press_home");
    expect(results.l.is_error).toBe(true);
    expect(flat(results.l.content)).toContain("No app id given");
    expect((await app.calls("launch_app"))[0].args).toEqual({ appId: "com.example.app" });
    expect((await app.calls("stop_app"))[0].args).toEqual({ appId: "com.example.app" });
    expect(JSON.stringify(results.p.content)).toContain('"type":"image"');
    expect(JSON.stringify(results.p.content)).toContain("image/png");
    await expect(page.getByRole("button", { name: "Tap (200.6, 423.2)" })).toBeVisible();
    await expect(page.getByRole("button", { name: 'Saisie "user@example.com"' })).toBeVisible();
    await expect(page.getByRole("button", { name: "Touche home" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Lance com.example.app" })).toBeVisible();
  });
});
