// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

import { test as base, expect, type Page } from "@playwright/test";

import { installTauriMock, type RecordedCall, type Scenario } from "./tauriMock";

/** zustand `persist` blob. */
const persisted = (state: Record<string, unknown>) => JSON.stringify({ state, version: 0 });

/** First-run prompts already answered, so tests start on the workspace. */
const SETTLED_STORAGE: Record<string, string> = {
  "maestro-deck.telemetry": persisted({ consent: "denied", decidedAt: null, installId: null }),
  "maestro-deck.tour": persisted({ hasSeenTour: true }),
  "maestro-deck.onboarding": persisted({ done: true }),
  "maestro-deck.cloud-invite": persisted({ asked: true }),
};

export class App {
  constructor(readonly page: Page) {}

  /** Loads the app against `scenario` and waits for the splash to go. */
  async launch(scenario: Scenario = {}, opts: { firstRun?: boolean } = {}): Promise<void> {
    const storage = { ...(opts.firstRun ? {} : SETTLED_STORAGE), ...(scenario.storage ?? {}) };
    await this.page.addInitScript(installTauriMock, { ...scenario, storage });
    await this.page.goto("/");
    await this.page.locator("#splash").waitFor({ state: "detached" });
  }

  /** Pushes a backend event (runner output, frames, quit request…). */
  async emit(event: string, payload: unknown = null): Promise<void> {
    await this.page.evaluate(
      ([e, p]) =>
        (window as unknown as { __e2e: { emit: (e: string, p: unknown) => void } }).__e2e.emit(
          e,
          p,
        ),
      [event, payload] as const,
    );
  }

  /** IPC calls the app made, optionally for one command. */
  async calls(cmd?: string): Promise<RecordedCall[]> {
    return this.page.evaluate(
      (c) =>
        (window as unknown as { __e2e: { calls: (c?: string) => RecordedCall[] } }).__e2e.calls(c),
      cmd,
    );
  }

  /** Content of a file in the virtual file system. */
  async file(path: string): Promise<string | undefined> {
    return this.page.evaluate(
      (p) =>
        (window as unknown as { __e2e: { state: { files: Record<string, string> } } }).__e2e.state
          .files[p],
      path,
    );
  }

  /** Queues answers for the next native dialogs. */
  async answerDialogs(
    kind: "open" | "save" | "message",
    ...answers: Array<string | null>
  ): Promise<void> {
    await this.page.evaluate(
      ([k, a]) => {
        const q = (
          window as unknown as { __e2e: { state: { dialogs: Record<string, unknown[]> } } }
        ).__e2e.state.dialogs;
        q[k].push(...a);
      },
      [kind, answers] as const,
    );
  }

  /** Replaces the answer of a command for the rest of the test. */
  async respond(cmd: string, value: unknown): Promise<void> {
    await this.page.evaluate(
      ([c, v]) => {
        (
          window as unknown as { __e2e: { state: { responses: Record<string, unknown> } } }
        ).__e2e.state.responses[c] = v;
      },
      [cmd, value] as const,
    );
  }

  async settle(cmd: string, value: unknown = null, error?: string): Promise<void> {
    await this.page.evaluate(
      ([c, v, e]) =>
        (
          window as unknown as {
            __e2e: { settle: (c: string, v: unknown, e?: string) => void };
          }
        ).__e2e.settle(c, v, e ?? undefined),
      [cmd, value, error ?? null] as const,
    );
  }

  async setDevices(devices: unknown[]): Promise<void> {
    await this.page.evaluate((d) => {
      (window as unknown as { __e2e: { state: { devices: unknown[] } } }).__e2e.state.devices = d;
    }, devices);
  }

  /** Waits until `cmd` has been called at least `times` times. */
  async waitForCall(cmd: string, times = 1): Promise<RecordedCall[]> {
    await expect.poll(async () => (await this.calls(cmd)).length).toBeGreaterThanOrEqual(times);
    return this.calls(cmd);
  }
}

export const test = base.extend<{ app: App }>({
  app: async ({ page }, use) => {
    await use(new App(page));
    if (process.env.E2E_COVERAGE) {
      const cov = await page
        .evaluate(() => (window as unknown as { __coverage__?: unknown }).__coverage__)
        .catch(() => undefined);
      if (cov) {
        mkdirSync(".nyc_output", { recursive: true });
        writeFileSync(`.nyc_output/${randomUUID()}.json`, JSON.stringify(cov));
      }
    }
  },
});

export { expect };
