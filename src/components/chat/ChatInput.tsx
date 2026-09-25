// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { ArrowUp, Loader2, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";
import { useBillyVoiceStore } from "@/stores/billyVoiceStore";
import { useChatStore } from "@/stores/chatStore";

import { RecordingMeter } from "./RecordingMeter";

const MAX_HEIGHT = 180;

export function ChatInput() {
  const [value, setValue] = useState("");
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const cancel = useChatStore((s) => s.cancel);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const bumpScroll = useChatStore((s) => s.bumpScroll);

  // A draft handed over from elsewhere (the editor's "Ask Billy"): put it in
  // the input with the caret at the end, ready for the user's question.
  const draft = useChatStore((s) => s.draft);
  useEffect(() => {
    if (draft === null) return;
    const text = useChatStore.getState().takeDraft();
    if (text === null) return;
    setValue(text);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
      el.scrollTop = el.scrollHeight;
    });
  }, [draft]);

  // Voice goes through Maestro Deck Cloud (Voxtral), so the mic is only
  // offered with that provider.
  const voiceAvailable = useChatStore((s) => s.currentProvider === "maestrodeck");
  const voicePhase = useBillyVoiceStore((s) => s.phase);
  const startRecording = useBillyVoiceStore((s) => s.startRecording);
  const sendRecording = useBillyVoiceStore((s) => s.sendRecording);
  const cancelRecording = useBillyVoiceStore((s) => s.cancelRecording);
  const recordingActive = voicePhase === "recording";

  useEffect(() => {
    if (!recordingActive) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") cancelRecording();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recordingActive, cancelRecording]);

  // Auto-grow textarea up to MAX_HEIGHT. Whenever the height actually
  // changes, ping MessageList to re-anchor its scroll to the bottom —
  // otherwise the newly-taller input hides the latest message.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const before = el.style.height;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, MAX_HEIGHT);
    const nextStyle = `${next}px`;
    el.style.height = nextStyle;
    if (before !== nextStyle) bumpScroll();
  }, [value, bumpScroll]);

  const submit = () => {
    const text = value;
    if (!text.trim()) return;
    setValue("");
    void sendMessage(text);
    requestAnimationFrame(() => ref.current?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const canSend = value.trim().length > 0;

  return (
    <div className="px-3 pb-3 pt-2">
      <div
        className={cn(
          "group relative flex flex-col rounded-2xl border border-border bg-muted/40 px-3 pt-2.5 pb-2 transition-colors",
          "focus-within:border-primary/60 focus-within:bg-background focus-within:shadow-sm",
        )}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message Billy…"
          disabled={isStreaming}
          rows={1}
          className={cn(
            "max-h-[180px] w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground",
            "disabled:opacity-50",
          )}
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          {recordingActive ? (
            <RecordingMeter />
          ) : voicePhase === "transcribing" ? (
            <span className="text-[10px] text-muted-foreground">Transcribing…</span>
          ) : (
            <span className="text-[10px] text-muted-foreground/70">
              <kbd className="rounded border border-border bg-background px-1 font-mono text-[9px]">
                Enter
              </kbd>{" "}
              to send,{" "}
              <kbd className="rounded border border-border bg-background px-1 font-mono text-[9px]">
                Shift + Enter
              </kbd>{" "}
              for newline
            </span>
          )}
          <div className="flex items-center gap-1.5">
            {voiceAvailable && !isStreaming && (
              <button
                type="button"
                onClick={() => void (recordingActive ? sendRecording() : startRecording())}
                disabled={voicePhase === "transcribing"}
                aria-label={recordingActive ? "Send voice question" : "Ask by voice"}
                title={recordingActive ? "Send" : "Ask Billy by voice"}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full transition-all",
                  recordingActive
                    ? "bg-destructive text-destructive-foreground hover:opacity-80"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  "disabled:cursor-wait disabled:opacity-60",
                )}
              >
                {voicePhase === "transcribing" ? (
                  <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
                ) : recordingActive ? (
                  <Square className="h-3 w-3 fill-current" />
                ) : (
                  <Mic className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            {isStreaming ? (
              <button
                type="button"
                onClick={cancel}
                aria-label="Stop"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                aria-label="Send"
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full transition-all",
                  canSend
                    ? "bg-primary text-primary-foreground hover:scale-105"
                    : "bg-muted text-muted-foreground/50 cursor-not-allowed",
                )}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
