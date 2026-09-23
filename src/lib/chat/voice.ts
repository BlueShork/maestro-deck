// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/**
 * Voice for Billy on Maestro Deck Cloud: record a question, have the server
 * transcribe it (Voxtral), and play the spoken answer back. Same format and
 * limits as the iOS app: 16 kHz mono 16-bit WAV, 60 s at most.
 *
 * Recording goes through Web Audio rather than MediaRecorder, whose output
 * format differs per webview (AAC on WebKit, Opus on WebView2, none on some
 * WebKitGTK builds); raw samples encode to the same WAV everywhere.
 */

import { CLOUD_DASHBOARD_URL, getCloudIdToken } from "@/lib/cloudAuth";

export const MAX_RECORDING_SECONDS = 60;
const WAV_RATE = 16_000;

// ---------------------------------------------------------------------------
// WAV encoding (pure)
// ---------------------------------------------------------------------------

/** Downsample mono float samples to 16 kHz and wrap them as 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, inputRate: number): Uint8Array<ArrayBuffer> {
  const ratio = inputRate / WAV_RATE;
  const length = Math.floor(samples.length / ratio);
  const out = new Uint8Array(44 + length * 2);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, WAV_RATE, true);
  view.setUint32(28, WAV_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, length * 2, true);

  // Average each window of input samples: a cheap low-pass that keeps
  // downsampling from folding high frequencies into the speech band.
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    const s = Math.max(-1, Math.min(1, sum / (end - start)));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Audio context: one per app, unlocked by the mic click
// ---------------------------------------------------------------------------

let context: AudioContext | null = null;

/** Created (or resumed) inside the mic button's click: WebKit only lets a
 *  context play sound once a user gesture has started it, and the answer
 *  arrives long after that gesture. */
function audioContext(): AudioContext {
  context ??= new AudioContext();
  void context.resume();
  return context;
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export interface Recording {
  /** Stop and return the WAV, or null when nothing usable was captured. */
  finish(): Blob | null;
  cancel(): void;
}

export class MicDeniedError extends Error {
  constructor() {
    super("Microphone access was denied. Allow it for Maestro Deck in your system settings.");
  }
}

/** Starts capturing the microphone. `onMaxDuration` fires once the recording
 *  hits MAX_RECORDING_SECONDS; the caller then finishes it. */
export async function startRecording(onMaxDuration: () => void): Promise<Recording> {
  const ctx = audioContext();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotAllowedError") throw new MicDeniedError();
    throw new Error("Couldn't start the microphone.", { cause: err });
  }

  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated but, unlike AudioWorklet, needs no
  // separate module file and works in every webview Tauri ships on.
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let captured = 0;
  const limit = MAX_RECORDING_SECONDS * ctx.sampleRate;
  let stopped = false;

  processor.onaudioprocess = (e) => {
    if (stopped) return;
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    captured += e.inputBuffer.length;
    if (captured >= limit) onMaxDuration();
  };
  source.connect(processor);
  // Some engines only run a processor that reaches the destination; its
  // output buffer is left silent, so nothing is heard.
  processor.connect(ctx.destination);

  const release = () => {
    stopped = true;
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    for (const track of stream.getTracks()) track.stop();
  };

  return {
    finish() {
      release();
      // Under half a second is a misclick, not a question.
      if (captured < ctx.sampleRate / 2) return null;
      const samples = new Float32Array(captured);
      let offset = 0;
      for (const chunk of chunks) {
        samples.set(chunk.subarray(0, captured - offset), offset);
        offset += chunk.length;
        if (offset >= captured) break;
      }
      return new Blob([encodeWav(samples, ctx.sampleRate)], { type: "audio/wav" });
    },
    cancel: release,
  };
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

let playing: AudioBufferSourceNode | null = null;

/** Plays MP3 bytes; resolves when playback ends or is stopped. */
export async function playAudio(mp3: ArrayBuffer): Promise<void> {
  stopAudio();
  const ctx = audioContext();
  // decodeAudioData detaches its input; keep the caller's copy replayable.
  const buffer = await ctx.decodeAudioData(mp3.slice(0));
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.connect(ctx.destination);
  playing = node;
  await new Promise<void>((resolve) => {
    node.onended = () => resolve();
    node.start();
  });
  if (playing === node) playing = null;
}

export function stopAudio() {
  const node = playing;
  playing = null;
  try {
    node?.stop();
  } catch {
    // Already stopped.
  }
}

// ---------------------------------------------------------------------------
// Server calls
// ---------------------------------------------------------------------------

async function post(
  path: string,
  body: FormData | string,
  contentType?: string,
): Promise<Response> {
  const token = await getCloudIdToken();
  let resp: Response;
  try {
    resp = await fetch(`${CLOUD_DASHBOARD_URL}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(contentType ? { "content-type": contentType } : {}),
      },
      body,
    });
  } catch (err) {
    throw new Error("Could not reach Maestro Deck Cloud. Check your connection and try again.", {
      cause: err,
    });
  }
  if (resp.status === 401) {
    throw new Error("Your Maestro Deck session expired — sign out and back in.");
  }
  if (!resp.ok) {
    const json = (await resp.json().catch(() => null)) as { error?: string } | null;
    throw new Error(json?.error ?? `Billy couldn't answer right now (HTTP ${resp.status}).`);
  }
  return resp;
}

export async function transcribe(wav: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", wav, "question.wav");
  const resp = await post("/api/assistant/transcribe", form);
  const json = (await resp.json()) as { transcript?: string };
  return (json.transcript ?? "").trim();
}

/** The answer read aloud as MP3, or null when there's nothing worth reading. */
export async function synthesize(text: string): Promise<ArrayBuffer | null> {
  const resp = await post("/api/assistant/speech", JSON.stringify({ text }), "application/json");
  return resp.status === 204 ? null : resp.arrayBuffer();
}
