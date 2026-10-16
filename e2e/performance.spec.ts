import { expect, test, type App } from "./support/app";
import { IPHONE_SIM, PIXEL } from "./support/data";

const sample = (over: Record<string, unknown> = {}) => ({
  package: "com.example.app",
  cpu_pct: 12.5,
  mem_mb: 312.4,
  fps: 58,
  jank_pct: 2.14,
  frame_p50_ms: 9,
  frame_p90_ms: 14,
  frame_p95_ms: 22,
  frame_p99_ms: 41,
  thermal_status: 2,
  net_rx_kbps: 0,
  net_tx_kbps: 0,
  ts: Date.now(),
  ...over,
});

async function connect(app: App, name: RegExp) {
  await app.page.getByRole("button", { name }).first().click();
  await app.waitForCall("connect_device");
  await expect(app.page.getByText("Live")).toBeVisible();
}

const tile = (app: App, label: string) =>
  app.page.locator("div.cursor-help").filter({ has: app.page.getByText(label, { exact: true }) });

test.describe("performance panel", () => {
  test("collects only while the tab is open, and shows the latest sample", async ({
    app,
    page,
  }) => {
    await app.launch({ devices: [PIXEL] });
    await connect(app, /Pixel 7/);
    expect(await app.calls("start_metrics")).toHaveLength(0);

    await page.getByRole("button", { name: "Performance" }).click();
    await app.waitForCall("start_metrics");
    await expect(page.getByText("Waiting for samples…")).toBeVisible();

    await app.emit("metrics:target_changed", { from: null, to: "com.example.app" });
    await app.emit("metrics:sample", sample({ cpu_pct: 40 }));
    await app.emit("metrics:sample", sample());
    await expect(page.locator(".mono-label", { hasText: "com.example.app" })).toBeVisible();
    await expect(tile(app, "CPU")).toContainText("12.5%");
    await expect(tile(app, "RAM")).toContainText("312MB");
    await expect(tile(app, "FPS")).toContainText("58");
    await expect(tile(app, "Jank")).toContainText("2.1%");
    await expect(tile(app, "Frame time (p95)")).toContainText("22ms");
    await expect(tile(app, "Thermal")).toContainText("Moderate");
    await expect(tile(app, "CPU").locator("svg")).toBeVisible();

    await page.getByRole("button", { name: "Simple" }).click();
    await app.waitForCall("stop_metrics");
  });

  test("a collector that dies says so", async ({ app, page }) => {
    await app.launch({ devices: [PIXEL] });
    await connect(app, /Pixel 7/);
    await page.getByRole("button", { name: "Performance" }).click();
    await app.waitForCall("start_metrics");
    await app.emit("metrics:sample", sample());
    await app.emit("metrics:stopped", { reason: "error", message: "dumpsys failed" });
    await expect(page.getByText("Monitoring stopped (error).")).toBeVisible();
  });

  test("a collector that can't start is reported", async ({ app, page }) => {
    await app.launch({ devices: [PIXEL], failures: { start_metrics: "no such package" } });
    await connect(app, /Pixel 7/);
    await page.getByRole("button", { name: "Performance" }).click();
    await expect(page.getByText("Performance monitoring failed to start")).toBeVisible();
  });

  test("the iOS simulator shows only what it can measure", async ({ app, page }) => {
    await app.launch({ devices: [IPHONE_SIM] });
    await connect(app, /iPhone 16 Pro/);
    await page.getByRole("button", { name: "Performance" }).click();
    await app.emit("metrics:sample", sample({ fps: null, jank_pct: null }));
    await expect(tile(app, "CPU")).toBeVisible();
    await expect(tile(app, "FPS")).toHaveCount(0);
    await expect(
      page.getByText("FPS and frame timing aren't available on the iOS simulator."),
    ).toBeVisible();
  });

  test("a physical iPhone and the web target explain why there are no metrics", async ({
    app,
    page,
  }) => {
    const iphone = { ...IPHONE_SIM, serial: "00008130-PHYS", model: "iPhone 15", physical: true };
    const chromium = {
      ...PIXEL,
      serial: "web:chromium",
      model: "Chromium",
      platform: "web",
      android_version: null,
    };
    await app.launch({ devices: [iphone, chromium] });
    await connect(app, /iPhone 15/);
    await page.getByRole("button", { name: "Performance" }).click();
    await expect(
      page.getByText("Per-app performance metrics aren't available on physical iPhones"),
    ).toBeVisible();
    await expect(tile(app, "CPU")).toHaveCount(0);

    await page.getByRole("banner").getByRole("button", { name: "Choose a device" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Chromium/ })
      .click();
    await expect(
      page.getByText("The Web target has no per-app performance metrics."),
    ).toBeVisible();
  });

  test("a new target app clears the previous app's samples", async ({ app, page }) => {
    await app.launch({ devices: [PIXEL] });
    await connect(app, /Pixel 7/);
    await page.getByRole("button", { name: "Performance" }).click();
    await app.waitForCall("start_metrics");
    await app.emit("metrics:target_changed", { from: null, to: "com.example.app" });
    await app.emit("metrics:sample", sample());
    await expect(tile(app, "CPU")).toContainText("12.5%");

    await app.emit("metrics:target_changed", { from: "com.example.app", to: "com.other.app" });
    await expect(page.locator(".mono-label", { hasText: "com.other.app" })).toBeVisible();
    await expect(page.getByText("Waiting for samples…")).toBeVisible();
    await app.emit("metrics:sample", sample({ package: "com.other.app", cpu_pct: 77 }));
    await expect(tile(app, "CPU")).toContainText("77.0%");
  });

  test("an unsupported stop is not shown as an error", async ({ app, page }) => {
    await app.launch({ devices: [PIXEL] });
    await connect(app, /Pixel 7/);
    await page.getByRole("button", { name: "Performance" }).click();
    await app.waitForCall("start_metrics");
    await app.emit("metrics:sample", sample());
    await app.emit("metrics:stopped", { reason: "unsupported", message: null });
    await expect(tile(app, "CPU")).toContainText("12.5%");
    await expect(page.getByText(/Monitoring stopped/)).toHaveCount(0);
  });

  test("the frame time tile lists every percentile on hover", async ({ app, page }) => {
    await app.launch({ devices: [PIXEL] });
    await connect(app, /Pixel 7/);
    await page.getByRole("button", { name: "Performance" }).click();
    await app.waitForCall("start_metrics");
    await app.emit("metrics:sample", sample());
    await tile(app, "Frame time (p95)").hover();
    await expect(page.getByRole("tooltip")).toContainText("p50: 9, p90: 14, p95: 22, p99: 41");
  });

  test("hiding the console stops collection, showing it again restarts it", async ({
    app,
    page,
  }) => {
    await app.launch({ devices: [PIXEL] });
    await connect(app, /Pixel 7/);
    await page.getByRole("button", { name: "Performance" }).click();
    await app.waitForCall("start_metrics");

    await page.getByRole("button", { name: "Toggle panels" }).click();
    await page.getByRole("menuitem", { name: "Run console" }).click();
    await app.waitForCall("stop_metrics");
    await page.getByRole("menuitem", { name: "Run console" }).click();
    await app.waitForCall("start_metrics", 2);
  });

  test("switching device restarts the collector and drops the old samples", async ({
    app,
    page,
  }) => {
    await app.launch({ devices: [PIXEL, IPHONE_SIM] });
    await connect(app, /Pixel 7/);
    await page.getByRole("button", { name: "Performance" }).click();
    await app.waitForCall("start_metrics");
    await app.emit("metrics:target_changed", { from: null, to: "com.example.app" });
    await app.emit("metrics:sample", sample());
    await expect(tile(app, "FPS")).toBeVisible();

    await page.getByRole("banner").getByRole("button", { name: "Choose a device" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /iPhone 16 Pro/ })
      .click();
    await app.waitForCall("connect_device", 2);
    await app.waitForCall("start_metrics", 2);
    await expect(page.getByText("Waiting for samples…")).toBeVisible();
    await expect(page.locator(".mono-label", { hasText: "com.example.app" })).toHaveCount(0);
  });

  test("without a device it asks for one and collects nothing", async ({ app, page }) => {
    await app.launch();
    await page.getByRole("button", { name: "Performance" }).click();
    await expect(page.getByText("Connect a device to monitor performance.")).toBeVisible();
    expect(await app.calls("start_metrics")).toHaveLength(0);
  });
});

test.describe("devices & performance settings", () => {
  test("the live stream can be turned off and on for the connected device", async ({
    app,
    page,
  }) => {
    await app.launch({ devices: [PIXEL] });
    await connect(app, /Pixel 7/);
    await page.goto("/#/settings/device");
    const toggle = page.getByRole("switch", { name: "Live device stream" });
    await toggle.click();
    await app.waitForCall("stop_stream");
    await expect(page.getByText("Stream off")).toBeVisible();
    await toggle.click();
    await app.waitForCall("start_stream");
    await expect(page.getByText("Stream on")).toBeVisible();
  });

  test("with the stream off, new connections skip the mirror", async ({ app, page }) => {
    await app.launch({ devices: [PIXEL] });
    await page.goto("/#/settings/device");
    await page.getByRole("switch", { name: "Live device stream" }).click();
    await page.goto("/#/");
    await connect(app, /Pixel 7/);
    const [call] = await app.calls("connect_device");
    expect(call.args).toMatchObject({ streamEnabled: false });
  });

  test("turning the web target off hides it from the picker", async ({ app, page }) => {
    const chromium = {
      ...PIXEL,
      serial: "web:chromium",
      model: "Chromium",
      platform: "web",
      android_version: null,
    };
    await app.launch({ devices: [PIXEL, chromium] });
    const picker = page.getByRole("dialog");
    await page.getByRole("banner").getByRole("button", { name: "Choose a device" }).click();
    await expect(picker.getByRole("button", { name: /Chromium/ })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/#/settings/device");
    const web = page
      .locator("div")
      .filter({ hasText: /^Web browser target/ })
      .locator("..")
      .getByRole("switch");
    await expect(web).toHaveAttribute("aria-checked", "true");
    await web.click();
    await page.goto("/#/");
    await page.getByRole("banner").getByRole("button", { name: "Choose a device" }).click();
    await expect(picker.getByRole("button", { name: /Pixel 7/ })).toBeVisible();
    await expect(picker.getByRole("button", { name: /Chromium/ })).toHaveCount(0);
  });

  test("turning fast hierarchy off makes inspect use the slow path", async ({ app, page }) => {
    await app.launch({ devices: [IPHONE_SIM] });
    await page.goto("/#/settings/device");
    const fast = page
      .locator("div")
      .filter({ hasText: /^Fast hierarchy/ })
      .locator("..")
      .getByRole("switch");
    await expect(fast).toHaveAttribute("aria-checked", "true");
    await fast.click();
    await page.goto("/#/");
    await connect(app, /iPhone 16 Pro/);
    await page.getByRole("button", { name: "Toggle inspect mode" }).click();
    const [call] = await app.waitForCall("enter_inspect_mode");
    expect(call.args).toEqual({ fastMode: false });
  });
});
