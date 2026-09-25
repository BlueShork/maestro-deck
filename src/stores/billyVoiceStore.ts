// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";

import { finalAnswerText } from "@/lib/chat/content";
import {
  playAudio,
  startRecording,
  stopAudio,
  synthesize,
  transcribe,
  type Recording,
} from "@/lib/chat/voice";
import { useChatStore } from "@/stores/chatStore";

/**
 * Talking to Billy on Maestro Deck Cloud, like in the iOS app: a spoken
 * question is transcribed and sent as a normal message (Billy keeps his
 * tools), and the answer is read aloud once he's done.
 */
interface BillyVoiceState {
  /** `transcribing`: the recording is on its way to the server. */
  phase: "idle" | "recording" | "transcribing";
  /** The answer being read aloud or synthesized, if any. */
  speakingId: string | null;
  /** Spoken answers, kept so they can be replayed (not persisted). */
  audio: Record<string, ArrayBuffer>;

  startRecording: () => Promise<void>;
  sendRecording: () => Promise<void>;
  cancelRecording: () => void;
  /** Play (or replay) the spoken version of an answer; stops if it's playing. */
  toggleSpeech: (messageId: string) => Promise<void>;
  stopSpeaking: () => void;
}

let recording: Recording | null = null;

/** Live level (0…1) and elapsed seconds of the recording in progress, read
 *  by the meter on each animation frame rather than pushed through the store
 *  (which would re-render the chat 60 times a second). */
export function recordingMeter(): { level: number; elapsed: number } | null {
  return recording ? { level: recording.level(), elapsed: recording.elapsed() } : null;
}

const reportError = (err: unknown) =>
  useChatStore.setState({ error: err instanceof Error ? err.message : String(err) });

export const useBillyVoiceStore = create<BillyVoiceState>((set, get) => ({
  phase: "idle",
  speakingId: null,
  audio: {},

  startRecording: async () => {
    if (get().phase !== "idle" || useChatStore.getState().isStreaming) return;
    get().stopSpeaking();
    useChatStore.setState({ error: null });
    set({ phase: "recording" });
    let started: Recording;
    try {
      // The first time, this waits on the system's microphone prompt.
      started = await startRecording(() => void get().sendRecording());
    } catch (err) {
      set({ phase: "idle" });
      reportError(err);
      return;
    }
    // Cancelled while the microphone was starting: release it right away.
    if (get().phase !== "recording") started.cancel();
    else recording = started;
  },

  cancelRecording: () => {
    recording?.cancel();
    recording = null;
    set({ phase: "idle" });
  },

  sendRecording: async () => {
    if (get().phase !== "recording" || !recording) return;
    const wav = recording.finish();
    recording = null;
    if (!wav) {
      set({ phase: "idle" });
      return;
    }

    set({ phase: "transcribing" });
    let question: string;
    try {
      question = await transcribe(wav);
    } catch (err) {
      set({ phase: "idle" });
      reportError(err);
      return;
    }
    set({ phase: "idle" });
    if (!question) {
      reportError(new Error("Billy didn't catch that. Try again a little closer to the mic."));
      return;
    }

    const answerId = await useChatStore.getState().sendMessage(question, { viaVoice: true });
    if (answerId) await get().toggleSpeech(answerId);
  },

  toggleSpeech: async (messageId) => {
    if (get().speakingId === messageId) {
      get().stopSpeaking();
      return;
    }
    get().stopSpeaking();
    set({ speakingId: messageId });
    try {
      let mp3: ArrayBuffer | null = get().audio[messageId] ?? null;
      if (!mp3) {
        const message = useChatStore.getState().messages.find((m) => m.id === messageId);
        const text = message ? finalAnswerText(message).trim() : "";
        mp3 = text ? await synthesize(text) : null;
        if (!mp3) return;
        const bytes = mp3;
        set((s) => ({ audio: { ...s.audio, [messageId]: bytes } }));
      }
      // Stopped (or another answer started) while the audio was on its way.
      if (get().speakingId !== messageId) return;
      await playAudio(mp3);
    } catch (err) {
      reportError(err);
    } finally {
      if (get().speakingId === messageId) set({ speakingId: null });
    }
  },

  stopSpeaking: () => {
    stopAudio();
    set({ speakingId: null });
  },
}));

// Clearing the chat drops the spoken answers with it.
useChatStore.subscribe((s, prev) => {
  if (s.messages.length === 0 && prev.messages.length > 0) {
    useBillyVoiceStore.getState().stopSpeaking();
    useBillyVoiceStore.setState({ audio: {} });
  }
});
