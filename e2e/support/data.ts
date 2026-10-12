// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { deflateSync } from "node:zlib";

export const WS = "/Users/me/flows";

export const LOGIN_FLOW = `appId: com.example.app
name: Login
---
- launchApp
- tapOn: "Login"
- inputText: "user@example.com"
- assertVisible: "Welcome"
`;

export const CHECKOUT_FLOW = `appId: com.example.app
---
- launchApp
- tapOn: "Cart"
`;

const file = (path: string) => ({ kind: "file", name: path.split("/").pop(), path });
const dir = (path: string, children: unknown[]) => ({
  kind: "dir",
  name: path.split("/").pop(),
  path,
  children,
});

export const WORKSPACE_TREE = dir(WS, [
  dir(`${WS}/auth`, [file(`${WS}/auth/login.yaml`)]),
  file(`${WS}/checkout.yaml`),
]);

export const WORKSPACE_FILES = {
  [`${WS}/auth/login.yaml`]: LOGIN_FLOW,
  [`${WS}/checkout.yaml`]: CHECKOUT_FLOW,
};

/** A workspace already open, its tree listable and its files readable. */
export const withWorkspace = {
  files: WORKSPACE_FILES,
  trees: { [WS]: WORKSPACE_TREE },
  storage: {
    "maestro-deck.workspace": JSON.stringify({
      state: { folderPath: WS, expanded: {}, lastOpenFile: null },
      version: 0,
    }),
  },
};

export const PIXEL = {
  serial: "emulator-5554",
  model: "Pixel 7",
  android_version: "15",
  screen_width: 1080,
  screen_height: 2400,
  platform: "android",
  os_version: "15",
  booted: true,
  physical: false,
};

export const IPHONE_SIM = {
  serial: "8F4C-SIM",
  model: "iPhone 16 Pro",
  android_version: null,
  screen_width: 1206,
  screen_height: 2622,
  platform: "ios",
  os_version: "18.2",
  booted: true,
  physical: false,
};

/** Maestro's plain-text output for a run of LOGIN_FLOW. */
export const PASSING_RUN = [
  "Running on emulator-5554",
  " > Flow Login",
  'Launch app "com.example.app"... COMPLETED',
  'Tap on "Login"... COMPLETED',
  'Input text "user@example.com"... COMPLETED',
  'Assert that "Welcome" is visible... COMPLETED',
];

export const FAILING_RUN = [
  "Running on emulator-5554",
  " > Flow Login",
  'Launch app "com.example.app"... COMPLETED',
  'Tap on "Login"... COMPLETED',
  'Input text "user@example.com"... COMPLETED',
  'Assert that "Welcome" is visible... FAILED',
  'Assertion is false: "Welcome" is visible',
];

// ── PNG generation (no dependency): a phone-like screen with bands. ───────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Base64 PNG of a fake app screen: header bar, a button, list rows. */
export function screenPng(width: number, height: number, accent = [255, 92, 0]): string {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      let rgb = [245, 245, 247];
      if (y < height * 0.1) rgb = accent;
      else if (y > height * 0.45 && y < height * 0.52 && x > width * 0.15 && x < width * 0.85)
        rgb = [20, 20, 24];
      else if (y > height * 0.6 && Math.floor((y - height * 0.6) / (height * 0.06)) % 2 === 0)
        rgb = [225, 225, 230];
      row.set(rgb, 1 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}
