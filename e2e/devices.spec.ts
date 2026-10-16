import { expect, test, type App } from "./support/app";
import { HIERARCHY, IPHONE_SIM, PIXEL, screenPng } from "./support/data";

const W = 402;
const H = 874;

/** Pixel colour at a fraction of the device canvas. */
async function canvasPixel(app: App, fx: number, fy: number): Promise<number[]> {
  return app.page.evaluate(
    ([x, y]) => {
      const c = document.querySelector("canvas") as HTMLCanvasElement;
      const d = c
        .getContext("2d")!
        .getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data;
      return [d[0], d[1], d[2]];
    },
    [fx, fy] as const,
  );
}

async function connectSim(app: App) {
  await app.page
    .getByRole("button", { name: /iPhone 16 Pro/ })
    .first()
    .click();
  await app.waitForCall("connect_device");
  await expect(app.page.getByText("Device connected")).toBeVisible();
}

async function pushIosFrame(app: App, accent = [255, 92, 0]) {
  await app.emit("ios_frame", { data: screenPng(W, H, accent), width: W, height: H });
}

test.describe("devices", () => {
  test("lists ready devices and connects one in a click", async ({ app, page }) => {
    await app.launch({ devices: [PIXEL, IPHONE_SIM] });
    await expect(page.getByText("Ready now")).toBeVisible();
    await page
      .getByRole("button", { name: /Pixel 7/ })
      .first()
      .click();
    const [call] = await app.waitForCall("connect_device");
    expect(call.args).toMatchObject({
      serial: "emulator-5554",
      platform: "android",
      streamEnabled: true,
    });
    await expect(page.getByText("Live")).toBeVisible();
    await expect(page.getByText("Pixel 7").first()).toBeVisible();
  });

  test("a failed connection is reported", async ({ app, page }) => {
    await app.launch({ devices: [PIXEL], failures: { connect_device: "device unauthorized" } });
    await page
      .getByRole("button", { name: /Pixel 7/ })
      .first()
      .click();
    await expect(page.getByText("Connect failed")).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("device unauthorized");
    // The panel says it too, without the technical "IPC … failed" prefix.
    await expect(
      page.locator("#inspector").getByText("device unauthorized", { exact: true }),
    ).toBeVisible();
  });

  test("an iOS simulator's screen is mirrored on the canvas", async ({ app, page }) => {
    await app.launch({ devices: [IPHONE_SIM] });
    await connectSim(app);
    await pushIosFrame(app);
    await expect(page.locator("canvas")).toBeVisible();
    await expect.poll(() => canvasPixel(app, 0.5, 0.02)).toEqual([255, 92, 0]);
  });

  test("frames from another platform never paint over the connected device", async ({
    app,
    page,
  }) => {
    await app.launch({ devices: [IPHONE_SIM] });
    await connectSim(app);
    await pushIosFrame(app, [255, 92, 0]);
    await expect.poll(() => canvasPixel(app, 0.5, 0.02)).toEqual([255, 92, 0]);
    // A web poller still winding down after a switch.
    await app.emit("web_frame", { data: screenPng(W, H, [0, 120, 255]), width: W, height: H });
    await page.waitForTimeout(300);
    expect(await canvasPixel(app, 0.5, 0.02)).toEqual([255, 92, 0]);
  });

  test("a device unplugged mid-session goes back to the empty state", async ({ app, page }) => {
    await app.launch({ devices: [IPHONE_SIM] });
    await connectSim(app);
    await pushIosFrame(app);
    await app.emit("device:disconnected");
    await expect(page.getByText("Device disconnected")).toBeVisible();
    await expect(page.getByText("No device yet")).toBeVisible();
    await expect(page.locator("canvas")).toBeHidden();
  });

  test("⇧⌘D opens the device picker", async ({ app, page }) => {
    await app.launch({ devices: [PIXEL, IPHONE_SIM] });
    await page.keyboard.press("ControlOrMeta+Shift+D");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Pixel 7")).toBeVisible();
  });
});

test.describe("inspect mode", () => {
  test("highlights the element under the pointer and inserts an action from the menu", async ({
    app,
    page,
  }) => {
    await app.launch({
      devices: [IPHONE_SIM],
      responses: {
        enter_inspect_mode: HIERARCHY,
        query_element: HIERARCHY.root.children[0],
        suggest_selectors: [
          { kind: "resourceId", value: "login_button" },
          { kind: "text", value: "Log in" },
        ],
        generate_command: '- tapOn:\n    id: "login_button"\n',
      },
    });
    await connectSim(app);
    await pushIosFrame(app);
    await page.getByRole("button", { name: "Toggle inspect mode" }).click();
    await expect(page.getByRole("button", { name: "Toggle inspect mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const box = (await page.locator("canvas").boundingBox())!;
    const target = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.48 };
    await page.mouse.move(target.x, target.y);
    await expect(page.locator(".border-brand.pointer-events-none")).toBeVisible();

    await page.mouse.click(target.x, target.y, { button: "right" });
    const menu = page.getByRole("menu").first();
    await expect(menu.getByText('"Log in"')).toBeVisible();
    await menu.getByRole("menuitem", { name: /^Tap/ }).click();
    await expect(page.locator(".cm-content")).toContainText('id: "login_button"');
    expect((await app.calls("generate_command"))[0].args).toEqual({
      action: { kind: "tapOn", selector: { kind: "resourceId", value: "login_button" } },
    });
  });

  test("hovering an action shows every selector, and picking one inserts with it", async ({
    app,
    page,
  }) => {
    await app.launch({
      devices: [IPHONE_SIM],
      responses: {
        enter_inspect_mode: HIERARCHY,
        query_element: HIERARCHY.root.children[0],
        suggest_selectors: [
          { kind: "resourceId", value: "login_button" },
          { kind: "text", value: "Log in" },
        ],
      },
    });
    await connectSim(app);
    await pushIosFrame(app);
    await page.getByRole("button", { name: "Toggle inspect mode" }).click();
    await expect(page.getByRole("button", { name: "Toggle inspect mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const box = (await page.locator("canvas").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.48, { button: "right" });
    await page.getByRole("menuitem", { name: /^Tap/ }).hover();

    const option = page.getByRole("menuitem", { name: /text "Log in"/ });
    await expect(option).toBeVisible();
    // Present in the DOM is not enough: it must be what the user actually sees
    // at that spot (a clipping parent once hid it while it stayed "visible").
    const b = (await option.boundingBox())!;
    const onTop = await page.evaluate(
      ([x, y]) =>
        document.elementFromPoint(x, y)?.closest('[role="menuitem"]')?.textContent ?? null,
      [b.x + b.width / 2, b.y + b.height / 2] as const,
    );
    expect(onTop).toContain('text "Log in"');

    await option.click();
    await app.waitForCall("generate_command");
    expect((await app.calls("generate_command"))[0].args).toEqual({
      action: { kind: "tapOn", selector: { kind: "text", value: "Log in" } },
    });
  });

  test("a failed dump leaves inspect mode off and says why", async ({ app, page }) => {
    await app.launch({
      devices: [IPHONE_SIM],
      failures: { enter_inspect_mode: "driver not ready" },
    });
    await connectSim(app);
    await page.getByRole("button", { name: "Toggle inspect mode" }).click();
    await expect(page.getByText("driver not ready")).toBeVisible();
    await expect(page.getByRole("button", { name: "Toggle inspect mode" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
