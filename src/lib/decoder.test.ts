import { describe, it, expect } from "vitest";
import { splitAnnexB, annexBToAvcc, buildAvcc } from "./decoder";

const u8 = (...bytes: number[]) => new Uint8Array(bytes);

describe("splitAnnexB", () => {
  it("splits payload around 4-byte start codes", () => {
    const stream = u8(0, 0, 0, 1, 0xaa, 0xbb, 0, 0, 0, 1, 0xcc);
    const nals = splitAnnexB(stream);
    expect(nals.length).toBe(2);
    expect(Array.from(nals[0])).toEqual([0xaa, 0xbb]);
    expect(Array.from(nals[1])).toEqual([0xcc]);
  });

  it("splits payload around 3-byte start codes", () => {
    const stream = u8(0, 0, 1, 0xaa, 0, 0, 1, 0xbb, 0xcc);
    const nals = splitAnnexB(stream);
    expect(nals.length).toBe(2);
    expect(Array.from(nals[0])).toEqual([0xaa]);
    expect(Array.from(nals[1])).toEqual([0xbb, 0xcc]);
  });

  it("handles mixed 3- and 4-byte start codes", () => {
    const stream = u8(0, 0, 0, 1, 0xaa, 0, 0, 1, 0xbb);
    const nals = splitAnnexB(stream);
    expect(nals.length).toBe(2);
    expect(Array.from(nals[0])).toEqual([0xaa]);
    expect(Array.from(nals[1])).toEqual([0xbb]);
  });

  it("returns [] for stream without start codes", () => {
    expect(splitAnnexB(u8(0xaa, 0xbb, 0xcc))).toEqual([]);
  });

  it("returns [] for empty stream", () => {
    expect(splitAnnexB(u8())).toEqual([]);
  });

  it("skips empty NAL between adjacent start codes", () => {
    const stream = u8(0, 0, 0, 1, 0, 0, 0, 1, 0xaa);
    const nals = splitAnnexB(stream);
    expect(nals.length).toBe(1);
    expect(Array.from(nals[0])).toEqual([0xaa]);
  });
});

describe("annexBToAvcc", () => {
  it("replaces 4-byte start codes with big-endian length prefixes", () => {
    const stream = u8(0, 0, 0, 1, 0xaa, 0xbb, 0, 0, 0, 1, 0xcc);
    const out = annexBToAvcc(stream);
    expect(Array.from(out)).toEqual([0, 0, 0, 2, 0xaa, 0xbb, 0, 0, 0, 1, 0xcc]);
  });

  it("encodes lengths > 255 across the 4 length bytes", () => {
    const nal = new Uint8Array(300).fill(0x42);
    const stream = new Uint8Array(4 + 300);
    stream.set([0, 0, 0, 1], 0);
    stream.set(nal, 4);
    const out = annexBToAvcc(stream);
    expect(out.length).toBe(4 + 300);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe((300 >>> 8) & 0xff);
    expect(out[3]).toBe(300 & 0xff);
  });

  it("returns empty when no NALs", () => {
    expect(annexBToAvcc(u8()).length).toBe(0);
  });
});

describe("buildAvcc", () => {
  // Minimal SPS: NAL header 0x67 (type=7), then profile/compat/level
  const SPS = u8(0x67, 0x42, 0xc0, 0x1e, 0xab, 0xcd);
  // PPS: NAL header 0x68 (type=8)
  const PPS = u8(0x68, 0xee, 0x3c, 0x80);

  function configPacket(sps: Uint8Array, pps: Uint8Array): Uint8Array {
    const out = new Uint8Array(4 + sps.length + 4 + pps.length);
    out.set([0, 0, 0, 1], 0);
    out.set(sps, 4);
    out.set([0, 0, 0, 1], 4 + sps.length);
    out.set(pps, 8 + sps.length);
    return out;
  }

  it("derives codec string from SPS bytes", () => {
    const { codec } = buildAvcc(configPacket(SPS, PPS));
    expect(codec).toBe("avc1.42c01e");
  });

  it("builds an avcC description with version+profile+SPS+PPS layout", () => {
    const { description } = buildAvcc(configPacket(SPS, PPS));
    expect(description[0]).toBe(0x01); // configurationVersion
    expect(description[1]).toBe(0x42); // profile
    expect(description[2]).toBe(0xc0); // compat
    expect(description[3]).toBe(0x1e); // level
    expect(description[4]).toBe(0xff);
    expect(description[5]).toBe(0xe1);
    // SPS length (big-endian) at bytes 6..7
    expect((description[6] << 8) | description[7]).toBe(SPS.length);
    // SPS bytes follow
    expect(Array.from(description.slice(8, 8 + SPS.length))).toEqual(Array.from(SPS));
    // numOfPPS
    expect(description[8 + SPS.length]).toBe(0x01);
    // PPS length
    const ppsLenOff = 9 + SPS.length;
    expect((description[ppsLenOff] << 8) | description[ppsLenOff + 1]).toBe(PPS.length);
    expect(Array.from(description.slice(ppsLenOff + 2))).toEqual(Array.from(PPS));
  });

  it("throws when SPS is missing", () => {
    const stream = new Uint8Array(4 + PPS.length);
    stream.set([0, 0, 0, 1], 0);
    stream.set(PPS, 4);
    expect(() => buildAvcc(stream)).toThrow(/SPS or PPS/);
  });

  it("throws when PPS is missing", () => {
    const stream = new Uint8Array(4 + SPS.length);
    stream.set([0, 0, 0, 1], 0);
    stream.set(SPS, 4);
    expect(() => buildAvcc(stream)).toThrow(/SPS or PPS/);
  });

  it("throws when SPS is too short", () => {
    const shortSps = u8(0x67, 0x42, 0xc0); // only 3 bytes
    expect(() => buildAvcc(configPacket(shortSps, PPS))).toThrow(/SPS too short/);
  });
});
