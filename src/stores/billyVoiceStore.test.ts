// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { beforeEach, describe, expect, it, vi } from "vitest";

const voice = vi.hoisted(() => ({
  startRecording: vi.fn(),
  transcribe: vi.fn(),
  synthesize: vi.fn(),
  playAudio: vi.fn(),
  stopAudio: vi.fn(),
}));
vi.mock("@/lib/chat/voice", () => voice);

const chat = vi.hoisted(() => {
  const state = {
    isStreaming: false,
    error: null as string | null,
    messages: [] as { id: string; role: string; content: unknown }[],
    sendMessage: vi.fn(),
  };
  return {
    state,
    useChatStore: {
      getState: () => state,
      setState: (patch: Partial<typeof state>) => Object.assign(state, patch),
      subscribe: vi.fn(),
    },
  };
});
vi.mock("@/stores/chatStore", () => ({ useChatStore: chat.useChatStore }));

import { useBillyVoiceStore } from "./billyVoiceStore";

const recording = (wav: Blob | null) => ({ finish: vi.fn(() => wav), cancel: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  chat.state.error = null;
  chat.state.messages = [];
  useBillyVoiceStore.setState({ phase: "idle", speakingId: null, audio: {} });
});

describe("billyVoiceStore", () => {
  it("sends the transcript as a voice message, then reads the answer aloud", async () => {
    voice.startRecording.mockResolvedValue(recording(new Blob(["wav"])));
    voice.transcribe.mockResolvedValue("Lance le flow login");
    const mp3 = new ArrayBuffer(4);
    voice.synthesize.mockResolvedValue(mp3);
    voice.playAudio.mockResolvedValue(undefined);
    chat.state.sendMessage.mockImplementation(async () => {
      chat.state.messages = [{ id: "a1", role: "assistant", content: "C'est lancé." }];
      return "a1";
    });

    const store = useBillyVoiceStore.getState();
    await store.startRecording();
    expect(useBillyVoiceStore.getState().phase).toBe("recording");
    await store.sendRecording();

    expect(chat.state.sendMessage).toHaveBeenCalledWith("Lance le flow login", { viaVoice: true });
    expect(voice.synthesize).toHaveBeenCalledWith("C'est lancé.");
    expect(voice.playAudio).toHaveBeenCalledWith(mp3);
    expect(useBillyVoiceStore.getState()).toMatchObject({
      phase: "idle",
      speakingId: null,
      audio: { a1: mp3 },
    });
  });

  it("reports an empty transcript instead of sending it", async () => {
    voice.startRecording.mockResolvedValue(recording(new Blob(["wav"])));
    voice.transcribe.mockResolvedValue("");

    await useBillyVoiceStore.getState().startRecording();
    await useBillyVoiceStore.getState().sendRecording();

    expect(chat.state.sendMessage).not.toHaveBeenCalled();
    expect(chat.state.error).toMatch(/didn't catch that/);
    expect(useBillyVoiceStore.getState().phase).toBe("idle");
  });

  it("drops a recording too short to be a question", async () => {
    voice.startRecording.mockResolvedValue(recording(null));

    await useBillyVoiceStore.getState().startRecording();
    await useBillyVoiceStore.getState().sendRecording();

    expect(voice.transcribe).not.toHaveBeenCalled();
    expect(useBillyVoiceStore.getState().phase).toBe("idle");
  });

  it("releases the microphone when cancelled while it was starting", async () => {
    const rec = recording(null);
    let resolve!: (r: typeof rec) => void;
    voice.startRecording.mockReturnValue(new Promise((r) => (resolve = r)));

    const starting = useBillyVoiceStore.getState().startRecording();
    useBillyVoiceStore.getState().cancelRecording();
    resolve(rec);
    await starting;

    expect(rec.cancel).toHaveBeenCalled();
    expect(useBillyVoiceStore.getState().phase).toBe("idle");
  });

  it("surfaces a microphone error", async () => {
    voice.startRecording.mockRejectedValue(new Error("Microphone access was denied."));

    await useBillyVoiceStore.getState().startRecording();

    expect(chat.state.error).toBe("Microphone access was denied.");
    expect(useBillyVoiceStore.getState().phase).toBe("idle");
  });

  it("replays a cached answer without synthesizing it again", async () => {
    const mp3 = new ArrayBuffer(2);
    useBillyVoiceStore.setState({ audio: { a1: mp3 } });
    voice.playAudio.mockResolvedValue(undefined);

    await useBillyVoiceStore.getState().toggleSpeech("a1");

    expect(voice.synthesize).not.toHaveBeenCalled();
    expect(voice.playAudio).toHaveBeenCalledWith(mp3);
  });
});
