// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/** The DeviceView canvas holds the latest decoded device frame. It registers
 *  itself here so non-React code (Billy's take_screenshot tool) can capture
 *  a PNG without threading refs through the tree. */
let deviceCanvas: HTMLCanvasElement | null = null;

export function registerDeviceCanvas(c: HTMLCanvasElement | null): void {
  deviceCanvas = c;
}

export function captureDeviceFrame(maxWidth = 800): { base64: string } | null {
  const src = deviceCanvas;
  if (!src || src.width === 0 || src.height === 0) return null;
  const scale = Math.min(1, maxWidth / src.width);
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const target = document.createElement("canvas");
  target.width = w;
  target.height = h;
  const ctx = target.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  const dataUrl = target.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1] ?? "";
  return base64 ? { base64 } : null;
}
