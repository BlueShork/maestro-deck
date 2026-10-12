import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { toUint8Array } from "./ipc";

describe("toUint8Array", () => {
  it("decodes base64 frame payloads byte for byte", () => {
    expect([...toUint8Array("AAAAAWX/")]).toEqual([0, 0, 0, 1, 0x65, 0xff]);
  });

  it("decodes an empty payload", () => {
    expect(toUint8Array("")).toHaveLength(0);
  });

  it("round-trips every byte value", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const b64 = btoa(String.fromCharCode(...bytes));
    expect(toUint8Array(b64)).toEqual(bytes);
  });

  it("passes typed arrays through and wraps buffers and number arrays", () => {
    const u8 = new Uint8Array([1, 2]);
    expect(toUint8Array(u8)).toBe(u8);
    expect([...toUint8Array(new Uint8Array([3, 4]).buffer)]).toEqual([3, 4]);
    expect([...toUint8Array([5, 6])]).toEqual([5, 6]);
  });
});
