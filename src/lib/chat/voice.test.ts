// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cloudAuth", () => ({ CLOUD_DASHBOARD_URL: "", getCloudIdToken: vi.fn() }));

import { encodeWav } from "./voice";

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

describe("encodeWav", () => {
  it("writes a 16 kHz mono 16-bit PCM header", () => {
    const wav = encodeWav(new Float32Array(48_000), 48_000);
    const view = new DataView(wav.buffer);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 16)).toBe("WAVEfmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(wav, 36, 40)).toBe("data");
    // One second at 48 kHz becomes 16 000 samples of 2 bytes.
    expect(view.getUint32(40, true)).toBe(32_000);
    expect(wav.length).toBe(44 + 32_000);
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
  });

  it("averages each window and clamps to 16-bit range", () => {
    // 48 kHz → 16 kHz: every 3 input samples make one output sample.
    const wav = encodeWav(new Float32Array([0.5, 0.5, 0.5, -2, -2, -2, 1, 0, -1]), 48_000);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(Math.trunc(0.5 * 0x7fff));
    expect(view.getInt16(46, true)).toBe(-0x8000);
    expect(view.getInt16(48, true)).toBe(0);
  });
});
