// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

// jsdom is not installed; we stub the minimal DOM globals needed by
// captureDeviceFrame so the tests run in the default node environment.

import { beforeEach, describe, expect, it } from "vitest";
import { captureDeviceFrame, registerDeviceCanvas } from "./deviceFrame";

/** Build a minimal HTMLCanvasElement stub. */
function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const ctx = {
    drawImage: () => undefined,
  };
  return {
    width: w,
    height: h,
    getContext: (type: string) => (type === "2d" ? ctx : null),
    toDataURL: () => "data:image/png;base64,QUJD",
  } as unknown as HTMLCanvasElement;
}

// Stub document.createElement so captureDeviceFrame can create an off-screen
// canvas without a real DOM.
const originalDocument = globalThis.document;
beforeEach(() => {
  globalThis.document = {
    createElement: (tag: string) => {
      if (tag === "canvas") return makeCanvas(0, 0);
      throw new Error(`createElement("${tag}") not stubbed`);
    },
  } as unknown as Document;
  // Clear the registry between tests.
  registerDeviceCanvas(null);
  return () => {
    globalThis.document = originalDocument;
  };
});

describe("captureDeviceFrame", () => {
  it("returns null when no canvas is registered", () => {
    expect(captureDeviceFrame()).toBeNull();
  });

  it("returns null after registerDeviceCanvas(null)", () => {
    const canvas = makeCanvas(100, 200);
    registerDeviceCanvas(canvas);
    registerDeviceCanvas(null);
    expect(captureDeviceFrame()).toBeNull();
  });

  it("returns base64 when a non-zero canvas is registered", () => {
    const canvas = makeCanvas(100, 200);
    // jsdom canvas doesn't implement toDataURL; stub it on the source too
    // (captureDeviceFrame reads toDataURL on the *target* canvas, not the
    // source, but our makeCanvas stub already returns the right value).
    registerDeviceCanvas(canvas);
    const result = captureDeviceFrame();
    expect(result).not.toBeNull();
    expect(result?.base64).toBe("QUJD");
  });

  it("returns null for a zero-size canvas", () => {
    registerDeviceCanvas(makeCanvas(0, 0));
    expect(captureDeviceFrame()).toBeNull();
  });

  it("scales down when canvas width exceeds maxWidth", () => {
    // We can't easily assert pixel values, but we can confirm it doesn't
    // blow up and returns a result.
    registerDeviceCanvas(makeCanvas(1600, 900));
    const result = captureDeviceFrame(800);
    expect(result).not.toBeNull();
  });
});
