import { defineConfig, devices } from "@playwright/test";

// The real frontend, built and served by Vite, with the Tauri backend replaced by
// e2e/support/tauriMock.ts. Port 1430: 1420 belongs to `tauri dev`.
const PORT = 1430;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1400, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      // Anti-aliasing noise only; a real visual change is far above this.
      maxDiffPixelRatio: 0.002,
    },
  },
  // WebKit: the engine closest to the WKWebView Tauri ships on macOS.
  projects: [
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1400, height: 900 } },
    },
  ],
  webServer: {
    // The production build (React Compiler, lazy chunks) — what ships, and
    // it loads instantly instead of compiling modules on first request.
    command: `pnpm exec vite build --logLevel error && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
