// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cloudAuth", () => ({
  CLOUD_DASHBOARD_URL: "https://dash.test",
  getCloudIdToken: vi.fn(async () => "tok"),
}));

import {
  encodeWav,
  levelOf,
  MAX_RECORDING_SECONDS,
  MicDeniedError,
  playAudio,
  startRecording,
  stopAudio,
  synthesize,
  transcribe,
} from "./voice";

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

describe("levelOf", () => {
  it("reads silence as 0 and a full-scale signal as 1", () => {
    expect(levelOf(new Float32Array(512))).toBe(0);
    expect(levelOf(new Float32Array(512).fill(1))).toBe(1);
  });

  it("maps -25 dBFS to the middle of the meter", () => {
    const amplitude = 10 ** (-25 / 20);
    expect(levelOf(new Float32Array(512).fill(amplitude))).toBeCloseTo(0.5, 5);
  });
});

// ---------------------------------------------------------------------------
// Web Audio fakes. The module keeps one AudioContext for the app's lifetime,
// so a single fake context is shared and its parts are rebuilt per test.
// ---------------------------------------------------------------------------

const RATE = 16_000; // same as the WAV rate, so samples come out unresampled
const BLOCK = 4096;

interface FakeProcessor {
  onaudioprocess:
    | ((e: { inputBuffer: { length: number; getChannelData: () => Float32Array } }) => void)
    | null;
  connect: () => void;
  disconnect: ReturnType<typeof vi.fn>;
}

let processor: FakeProcessor;
let track: { stop: ReturnType<typeof vi.fn> };
let analyserData: Float32Array;
let sources: { onended: (() => void) | null; start: () => void; stop: ReturnType<typeof vi.fn> }[];
const getUserMedia = vi.fn();

class FakeAudioContext {
  sampleRate = RATE;
  destination = {};
  resume = vi.fn(async () => {});
  createMediaStreamSource() {
    return { connect: () => {}, disconnect: vi.fn() };
  }
  createScriptProcessor() {
    return processor;
  }
  createAnalyser() {
    return {
      fftSize: 0,
      connect: () => {},
      disconnect: () => {},
      getFloatTimeDomainData: (out: Float32Array) => out.set(analyserData.subarray(0, out.length)),
    };
  }
  // Like the real one, decoding detaches the buffer it is handed.
  async decodeAudioData(buf: ArrayBuffer) {
    structuredClone(buf, { transfer: [buf] });
    return { duration: 1 };
  }
  createBufferSource() {
    const node = {
      buffer: null as unknown,
      onended: null as (() => void) | null,
      connect: () => {},
      start: () => {},
      stop: vi.fn(() => node.onended?.()),
    };
    sources.push(node);
    return node;
  }
}

beforeEach(() => {
  processor = { onaudioprocess: null, connect: () => {}, disconnect: vi.fn() };
  track = { stop: vi.fn() };
  analyserData = new Float32Array(1024);
  sources = [];
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [track] });
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Feeds `count` blocks of `value` into the recorder. */
function feed(count: number, value = 0.25) {
  for (let i = 0; i < count; i++) {
    processor.onaudioprocess?.({
      inputBuffer: { length: BLOCK, getChannelData: () => new Float32Array(BLOCK).fill(value) },
    });
  }
}

async function wavSamples(blob: Blob): Promise<Int16Array> {
  const bytes = await blob.arrayBuffer();
  return new Int16Array(bytes.slice(44));
}

describe("startRecording", () => {
  it("reports a refused microphone as a permission problem", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    await expect(startRecording(() => {})).rejects.toBeInstanceOf(MicDeniedError);
  });

  it("reports any other microphone failure generically", async () => {
    getUserMedia.mockRejectedValue(new DOMException("busy", "NotReadableError"));
    const err = await startRecording(() => {}).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(MicDeniedError);
    expect((err as Error).message).toMatch(/microphone/);
  });

  it("discards a recording under half a second as a misclick", async () => {
    const rec = await startRecording(() => {});
    feed(1); // 4096 samples at 16 kHz ≈ 0.26 s

    expect(rec.finish()).toBeNull();
  });

  it("returns every captured sample, in order, as a WAV", async () => {
    const rec = await startRecording(() => {});
    feed(2, 0.25);
    feed(1, -0.5);

    const blob = rec.finish();

    expect(blob?.type).toBe("audio/wav");
    const samples = await wavSamples(blob!);
    expect(samples.length).toBe(3 * BLOCK);
    expect(samples[0]).toBe(Math.trunc(0.25 * 0x7fff));
    expect(samples[3 * BLOCK - 1]).toBe(-0x4000);
  });

  it("tracks how long it has been recording", async () => {
    const rec = await startRecording(() => {});
    feed(4);
    expect(rec.elapsed()).toBeCloseTo((4 * BLOCK) / RATE, 5);
  });

  it("signals the time limit once the maximum duration is reached", async () => {
    const onMax = vi.fn();
    await startRecording(onMax);
    const blocksToLimit = Math.ceil((MAX_RECORDING_SECONDS * RATE) / BLOCK);

    feed(blocksToLimit - 1);
    expect(onMax).not.toHaveBeenCalled();
    feed(1);
    expect(onMax).toHaveBeenCalled();
  });

  it("releases the microphone and ignores late audio once finished", async () => {
    const rec = await startRecording(() => {});
    feed(3);
    const handler = processor.onaudioprocess;

    rec.finish();
    handler?.({ inputBuffer: { length: BLOCK, getChannelData: () => new Float32Array(BLOCK) } });

    expect(track.stop).toHaveBeenCalled();
    expect(rec.elapsed()).toBeCloseTo((3 * BLOCK) / RATE, 5);
  });

  it("releases the microphone on cancel", async () => {
    const rec = await startRecording(() => {});
    rec.cancel();
    expect(track.stop).toHaveBeenCalled();
    expect(processor.disconnect).toHaveBeenCalled();
  });

  it("drives the meter from the live input and drops to 0 when stopped", async () => {
    const rec = await startRecording(() => {});
    analyserData.fill(1);
    expect(rec.level()).toBe(1);

    rec.cancel();
    expect(rec.level()).toBe(0);
  });
});

describe("playAudio", () => {
  it("resolves once playback has ended", async () => {
    let done = false;
    const playing = playAudio(new ArrayBuffer(8)).then(() => (done = true));
    await vi.waitFor(() => expect(sources).toHaveLength(1));
    expect(done).toBe(false);

    sources[0].onended?.();
    await playing;
    expect(done).toBe(true);
  });

  it("leaves the caller's bytes intact so the answer can be replayed", async () => {
    const mp3 = new ArrayBuffer(8);
    const playing = playAudio(mp3);
    await vi.waitFor(() => expect(sources).toHaveLength(1));
    sources[0].onended?.();
    await playing;

    expect(mp3.byteLength).toBe(8);
  });

  it("cuts off the previous answer when a new one starts", async () => {
    void playAudio(new ArrayBuffer(8));
    await vi.waitFor(() => expect(sources).toHaveLength(1));

    void playAudio(new ArrayBuffer(8));

    expect(sources[0].stop).toHaveBeenCalled();
    await vi.waitFor(() => expect(sources).toHaveLength(2));
    stopAudio();
  });

  it("stopAudio ends playback and is safe to call with nothing playing", async () => {
    const playing = playAudio(new ArrayBuffer(8));
    await vi.waitFor(() => expect(sources).toHaveLength(1));

    stopAudio();
    await playing;
    expect(() => stopAudio()).not.toThrow();
  });
});

describe("server calls", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  const lastCall = () =>
    fetchMock.mock.calls.at(-1) as [string, NonNullable<Parameters<typeof fetch>[1]>];

  it("uploads the recording and returns the trimmed transcript", async () => {
    fetchMock.mockResolvedValue(Response.json({ transcript: "  tap on login \n" }));
    const wav = new Blob([new Uint8Array(4)], { type: "audio/wav" });

    await expect(transcribe(wav)).resolves.toBe("tap on login");

    const [url, init] = lastCall();
    expect(url).toBe("https://dash.test/api/assistant/transcribe");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect((init.body as FormData).get("audio")).toBeInstanceOf(Blob);
  });

  it("reads a missing transcript as nothing said", async () => {
    fetchMock.mockResolvedValue(Response.json({}));
    await expect(transcribe(new Blob())).resolves.toBe("");
  });

  it("returns the spoken answer's bytes", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));

    const mp3 = await synthesize("Hello");

    expect(new Uint8Array(mp3!)).toEqual(new Uint8Array([1, 2, 3]));
    const [, init] = lastCall();
    expect(JSON.parse(init.body as string)).toEqual({ text: "Hello" });
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("returns null when the server has nothing worth reading aloud", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(synthesize("```yaml\n```")).resolves.toBeNull();
  });

  it("asks the user to sign in again on 401", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    await expect(synthesize("Hi")).rejects.toThrow(/session expired/);
  });

  it("shows the server's own error, or the status when there is none", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Audio too long" }, { status: 413 }));
    await expect(transcribe(new Blob())).rejects.toThrow("Audio too long");

    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 500 }));
    await expect(transcribe(new Blob())).rejects.toThrow("HTTP 500");
  });

  it("replaces a network failure with an actionable message", async () => {
    fetchMock.mockRejectedValue(new TypeError("Load failed"));
    await expect(transcribe(new Blob())).rejects.toThrow(/Check your connection/);
  });
});
