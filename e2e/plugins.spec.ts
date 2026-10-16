import type { Frame } from "@playwright/test";

import { expect, test, type App } from "./support/app";
import { WS, withWorkspace } from "./support/data";

test.use({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
});

const SHA = "a".repeat(64);
const entry = (id: string, name: string, version: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  description: `${name} for Maestro Deck`,
  repo: `maestro-deck/${id}`,
  version,
  minAppVersion: "1.0.0",
  url: `https://github.com/maestro-deck/${id}/releases/${version}.zip`,
  sha256: SHA,
  ...extra,
});

const REGISTRY = JSON.stringify({
  schema: 1,
  plugins: [
    entry("reportly", "Reportly", "1.0.0"),
    entry("github", "GitHub", "1.1.0"),
    entry("gitlab", "GitLab", "1.0.0"),
    entry("future", "Future", "1.0.0", { minAppVersion: "9.0.0" }),
    entry("mocha", "Catppuccin", "1.0.0", { kind: "theme" }),
    entry("tampered", "Tampered", "1.0.0", { sha256: "not-a-sha" }),
  ],
});

const permissions = {
  http: ["https://api.example.com"],
  open: ["https://example.com"],
  secrets: false,
};

const REPORTLY = {
  id: "reportly",
  version: "1.0.0",
  dev: false,
  error: null,
  grantedOrigins: ["https://jira.acme.dev"],
  manifest: {
    id: "reportly",
    name: "Reportly",
    version: "1.0.0",
    minAppVersion: "1.0.0",
    entry: "index.html",
    panel: { title: "Run reports" },
    permissions: { ...permissions, workspace: true, userOrigins: true, runs: true },
  },
};
const GITHUB_OLD = {
  id: "github",
  version: "1.0.0",
  dev: false,
  error: null,
  manifest: {
    id: "github",
    name: "GitHub",
    version: "1.0.0",
    minAppVersion: "1.0.0",
    entry: "index.html",
    panel: { title: "GitHub" },
    permissions,
  },
};
const BROKEN = {
  id: "oldie",
  version: "0.1.0",
  dev: false,
  error: "manifest.json: missing field `id`",
  manifest: null,
};
const MOCHA = {
  id: "mocha",
  version: "1.0.0",
  dev: false,
  error: null,
  manifest: {
    id: "mocha",
    name: "Catppuccin",
    version: "1.0.0",
    minAppVersion: "1.0.0",
    theme: "theme.json",
    permissions,
  },
  theme: { light: { background: "220 23% 95%" }, dark: { background: "240 21% 15%" } },
};

const marketplace = {
  responses: { plugins_registry: REGISTRY, plugins_list: [REPORTLY, GITHUB_OLD, BROKEN, MOCHA] },
};

const card = (app: App, name: string) =>
  app.page.locator("li").filter({ has: app.page.getByText(name, { exact: true }) });

const PLUGIN_HTML = `<!doctype html><meta charset="utf-8"><h1>Reportly inside</h1><script>
let n = 0; const waiting = {}; window.events = [];
addEventListener("message", (e) => {
  const d = e.data;
  if (d && d.type === "md-rpc-result") { waiting[d.id](d); delete waiting[d.id]; }
  if (d && d.type === "md-event") window.events.push(d);
});
window.rpc = (method, params) => new Promise((r) => {
  const id = "r" + ++n; waiting[id] = r;
  parent.postMessage({ type: "md-rpc", id, method, params }, "*");
});
</script>`;

async function servePlugins(app: App) {
  await app.page.route("http://mdplugin.localhost/**", (route) =>
    route.fulfill({ contentType: "text/html", body: PLUGIN_HTML }),
  );
}

async function openReportly(app: App): Promise<Frame> {
  await app.page.getByRole("button", { name: "Toggle Reportly" }).click();
  await expect(
    app.page.frameLocator('iframe[title="Reportly"]').getByText("Reportly inside"),
  ).toBeVisible();
  const frame = app.page
    .frames()
    .find((f) => f.url().startsWith("http://mdplugin.localhost/reportly/"));
  expect(frame).toBeTruthy();
  return frame!;
}

type RpcReply = { ok: boolean; result?: unknown; error?: { code: string; message: string } };
const rpc = (frame: Frame, method: string, params?: unknown) =>
  frame.evaluate(
    ([m, p]) =>
      (window as unknown as { rpc: (m: string, p: unknown) => Promise<unknown> }).rpc(m, p),
    [method, params] as const,
  ) as Promise<RpcReply>;

test.describe("plugin marketplace", () => {
  test("shows each plugin's state, and drops entries that fail validation", async ({
    app,
    page,
  }) => {
    await app.launch(marketplace);
    await page.goto("/#/plugins");
    await expect(page.getByText("4 installed · 6 in the marketplace")).toBeVisible();
    await expect(page.getByText("Tampered")).toHaveCount(0);

    await expect(card(app, "Reportly").getByText("Installed")).toBeVisible();
    await expect(card(app, "Reportly").getByRole("button", { name: "Open" })).toBeVisible();
    await expect(
      card(app, "GitHub").getByRole("button", { name: "Update to v1.1.0" }),
    ).toBeVisible();
    await expect(card(app, "GitLab").getByRole("button", { name: "Install" })).toBeVisible();
    await expect(
      card(app, "Future").getByText("Requires Maestro Deck 9.0.0 or later."),
    ).toBeVisible();
    await expect(card(app, "Future").getByRole("button", { name: "Install" })).toHaveCount(0);
    await expect(card(app, "oldie").getByText("Broken")).toBeVisible();
    await expect(card(app, "oldie").getByText("manifest.json: missing field `id`")).toBeVisible();
    await expect(card(app, "Catppuccin").getByText("Theme")).toBeVisible();
  });

  test("installs a plugin from its pinned release", async ({ app, page }) => {
    await app.launch(marketplace);
    await page.goto("/#/plugins");
    await expect(page.getByText("4 installed · 6 in the marketplace")).toBeVisible();
    const gitlab = {
      ...GITHUB_OLD,
      id: "gitlab",
      manifest: { ...GITHUB_OLD.manifest, id: "gitlab", name: "GitLab" },
    };
    await app.respond("plugins_list", [REPORTLY, GITHUB_OLD, BROKEN, MOCHA, gitlab]);
    await card(app, "GitLab").getByRole("button", { name: "Install" }).click();
    const [install] = await app.waitForCall("plugins_install");
    expect(install.args).toEqual({
      pin: {
        id: "gitlab",
        version: "1.0.0",
        url: "https://github.com/maestro-deck/gitlab/releases/1.0.0.zip",
        sha256: SHA,
      },
    });
    await expect(page.getByText("GitLab 1.0.0 installed")).toBeVisible();
    await expect(card(app, "GitLab").getByText("Installed")).toBeVisible();
    await page.goto("/#/");
    await expect(page.getByRole("button", { name: "Toggle GitLab" })).toBeVisible();
  });

  test("a failed install says why and leaves the card installable", async ({ app, page }) => {
    await app.launch({ ...marketplace, failures: { plugins_install: "sha256 mismatch" } });
    await page.goto("/#/plugins");
    await card(app, "GitLab").getByRole("button", { name: "Install" }).click();
    await expect(page.getByText("Could not install GitLab")).toBeVisible();
    await expect(page.getByText("sha256 mismatch")).toBeVisible();
    await expect(card(app, "GitLab").getByRole("button", { name: "Install" })).toBeEnabled();
  });

  test("uninstalling also forgets what the plugin stored", async ({ app, page }) => {
    await app.launch({
      ...marketplace,
      storage: {
        "maestro-deck.plugin.reportly.brand": '"acme"',
        "maestro-deck.plugin.github.token-hint": '"x"',
      },
    });
    await page.goto("/#/plugins");
    await expect(page.getByText("4 installed · 6 in the marketplace")).toBeVisible();
    await app.respond("plugins_list", [GITHUB_OLD, BROKEN, MOCHA]);
    await card(app, "Reportly").getByRole("button", { name: "Uninstall" }).click();
    const [call] = await app.waitForCall("plugins_uninstall");
    expect(call.args).toEqual({ id: "reportly" });
    await expect(card(app, "Reportly").getByRole("button", { name: "Install" })).toBeVisible();
    const left = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith("maestro-deck.plugin.")),
    );
    expect(left).toEqual(["maestro-deck.plugin.github.token-hint"]);
  });

  test("a granted origin can be revoked", async ({ app, page }) => {
    await app.launch(marketplace);
    await page.goto("/#/plugins");
    await expect(card(app, "Reportly").getByText("jira.acme.dev")).toBeVisible();
    await card(app, "Reportly").getByRole("button", { name: "Revoke" }).click();
    const [call] = await app.waitForCall("plugin_revoke_origin");
    expect(call.args).toMatchObject({ origin: "https://jira.acme.dev" });
  });

  test("a theme applies its colours to the whole app", async ({ app, page }) => {
    await app.launch(marketplace);
    await page.goto("/#/plugins");
    await card(app, "Catppuccin").getByRole("button", { name: "Apply" }).click();
    await expect(card(app, "Catppuccin").getByRole("button", { name: "Applied" })).toBeDisabled();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.style.getPropertyValue("--background")),
      )
      .toBe("220 23% 95%");
  });

  test("an unreachable marketplace keeps installed plugins and offers a retry", async ({
    app,
    page,
  }) => {
    await app.launch({ ...marketplace, failures: { plugins_registry: "github.com unreachable" } });
    await page.goto("/#/plugins");
    await expect(page.getByText("Couldn't reach the marketplace")).toBeVisible();
    await expect(page.getByText(/github\.com unreachable/)).toBeVisible();
    await expect(card(app, "Reportly")).toBeVisible();
    await app.page.evaluate(() => {
      delete (window as unknown as { __e2e: { state: { failures: Record<string, string> } } }).__e2e
        .state.failures.plugins_registry;
    });
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Couldn't reach the marketplace")).toBeHidden();
    await expect(card(app, "GitLab")).toBeVisible();
  });

  test("a registry from a newer schema asks to update the app", async ({ app, page }) => {
    await app.launch({
      responses: { plugins_registry: JSON.stringify({ schema: 2, plugins: [] }), plugins_list: [] },
    });
    await page.goto("/#/plugins");
    await expect(
      page.getByText(/Unsupported plugin registry schema: 2\. Update Maestro Deck\./),
    ).toBeVisible();
  });
});

test.describe("plugin panel and bridge", () => {
  test("opens in the side panel from its card, and closes when Billy opens", async ({
    app,
    page,
  }) => {
    await servePlugins(app);
    await app.launch(marketplace);
    await page.goto("/#/plugins");
    await card(app, "Reportly").getByRole("button", { name: "Open" }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByText("Run reports")).toBeVisible();
    await expect(
      page.frameLocator('iframe[title="Reportly"]').getByText("Reportly inside"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Toggle AI assistant" }).click();
    await expect(page.locator('iframe[title="Reportly"]')).toHaveCount(0);
  });

  test("answers the plugin's calls within its permissions", async ({ app, page }) => {
    await servePlugins(app);
    await app.launch({
      ...withWorkspace,
      responses: {
        ...marketplace.responses,
        plugin_http_fetch: { status: 200, headers: {}, body: '{"ok":true}' },
        plugin_workspace_info: { name: "flows", git: null },
      },
    });
    const frame = await openReportly(app);

    expect(await rpc(frame, "app.info")).toMatchObject({
      ok: true,
      result: { appVersion: "1.2.0", platform: "windows" },
    });

    expect((await rpc(frame, "storage.set", { key: "brand", value: { color: "#f60" } })).ok).toBe(
      true,
    );
    expect(await rpc(frame, "storage.get", { key: "brand" })).toMatchObject({
      result: { color: "#f60" },
    });
    expect(
      await page.evaluate(() => localStorage.getItem("maestro-deck.plugin.reportly.brand")),
    ).toBe('{"color":"#f60"}');

    const http = await rpc(frame, "http.fetch", {
      url: "https://api.example.com/x",
      method: "GET",
    });
    expect(http).toMatchObject({ ok: true, result: { status: 200 } });
    const [fetchCall] = await app.calls("plugin_http_fetch");
    expect(fetchCall.args).toMatchObject({
      pluginId: "reportly",
      request: { url: "https://api.example.com/x", method: "GET" },
    });

    expect(await rpc(frame, "secrets.get", { key: "token" })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(await app.calls("plugin_secret_get")).toHaveLength(0);

    expect(await rpc(frame, "workspace.info")).toMatchObject({
      ok: true,
      result: { name: "flows" },
    });
    expect((await app.calls("plugin_workspace_info"))[0].args).toMatchObject({
      pluginId: "reportly",
      workspace: WS,
    });

    expect(await rpc(frame, "storage.get", { key: "../escape" })).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });
    expect(await rpc(frame, "nope.nope")).toMatchObject({
      ok: false,
      error: { code: "unknown_method" },
    });
  });

  test("a plugin's toast shows in the app, with its link", async ({ app, page }) => {
    await servePlugins(app);
    await app.launch(marketplace);
    const frame = await openReportly(app);
    await rpc(frame, "ui.toast", {
      kind: "success",
      message: "Report uploaded",
      action: { label: "View", url: "https://example.com/r/1" },
    });
    await expect(page.getByText("Report uploaded")).toBeVisible();
    await page.getByRole("button", { name: "View" }).click();
    const [open] = await app.waitForCall("plugin_open_external");
    expect(open.args).toMatchObject({ url: "https://example.com/r/1" });
    expect(
      await rpc(frame, "ui.toast", {
        kind: "success",
        message: "x",
        action: { label: "L", url: "http://insecure" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });
  });

  test("a new origin needs the user's yes, and a no sticks for the session", async ({
    app,
    page,
  }) => {
    await servePlugins(app);
    await app.launch({
      ...marketplace,
      responses: { ...marketplace.responses, plugin_origin_allowed: false },
    });
    const frame = await openReportly(app);

    const asked = rpc(frame, "http.requestOrigin", { origin: "https://jira.example.org/" });
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Allow Reportly to connect to jira.example.org?")).toBeVisible();
    await dialog.getByRole("button", { name: "Allow" }).click();
    expect(await asked).toMatchObject({ ok: true, result: true });
    expect((await app.calls("plugin_grant_origin"))[0].args).toMatchObject({
      origin: "https://jira.example.org",
    });

    const refused = rpc(frame, "http.requestOrigin", { origin: "https://evil.example" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(await refused).toMatchObject({ ok: true, result: false });
    expect(
      await rpc(frame, "http.requestOrigin", { origin: "https://other.example" }),
    ).toMatchObject({ result: false });
    await expect(dialog).toBeHidden();

    expect(
      await rpc(frame, "http.requestOrigin", { origin: "http://plain.example" }),
    ).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });
  });

  test("receives the theme on load and the run report when a run ends", async ({ app, page }) => {
    await servePlugins(app);
    await app.launch({
      ...withWorkspace,
      ...marketplace,
      responses: marketplace.responses,
      devices: [],
      storage: {
        ...withWorkspace.storage,
        "maestro-deck.workspace": JSON.stringify({
          state: { folderPath: WS, expanded: {}, lastOpenFile: `${WS}/auth/login.yaml` },
          version: 0,
        }),
      },
    });
    await expect(page.locator(".cm-content")).toContainText("Welcome");
    const frame = await openReportly(app);
    await expect
      .poll(() =>
        frame.evaluate(() =>
          (window as unknown as { events: Array<{ name: string }> }).events.map((e) => e.name),
        ),
      )
      .toContain("theme");

    await page.getByRole("button", { name: /^Run$/ }).click();
    await app.waitForCall("run_flow");
    await app.emit("runner:stdout", " > Flow Login");
    await app.emit("runner:stdout", 'Launch app "com.example.app"... COMPLETED');
    await app.emit("runner:exit", { pid: 4242, code: 0 });
    await expect
      .poll(() =>
        frame.evaluate(() =>
          (window as unknown as { events: Array<{ name: string }> }).events.map((e) => e.name),
        ),
      )
      .toContain("run.finished");
    const latest = await rpc(frame, "runs.latest");
    expect(latest).toMatchObject({
      ok: true,
      result: {
        kind: "flow",
        status: "passed",
        title: "Login",
        project: { name: "flows" },
        items: [{ name: "launchApp", status: "passed" }, {}, {}, {}],
        totals: { passed: 1, failed: 0, skipped: 3 },
      },
    });
  });
});
