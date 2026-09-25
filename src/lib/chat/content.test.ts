// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/types/chat";

import { finalAnswerText, messageText, truncateToolResults } from "./content";

const msg = (content: ChatMessage["content"]): ChatMessage => ({
  id: "x",
  role: "assistant",
  content,
  createdAt: 0,
});

describe("messageText", () => {
  it("returns string content as-is", () => {
    expect(messageText(msg("hello"))).toBe("hello");
  });
  it("joins text blocks, skipping tool blocks", () => {
    expect(
      messageText(
        msg([
          { type: "text", text: "a" },
          { type: "tool_use", id: "1", name: "tap", input: {} },
          { type: "tool_result", toolUseId: "1", name: "tap", content: "ok" },
          { type: "text", text: "b" },
        ]),
      ),
    ).toBe("ab");
  });
});

describe("truncateToolResults", () => {
  const big = "x".repeat(3000);
  const result = (id: string) =>
    ({ type: "tool_result", toolUseId: id, name: "get_screen", content: big }) as const;

  it("keeps the 4 most recent results intact, truncates older ones", () => {
    const messages = [
      msg([result("1"), result("2")]),
      msg([result("3"), result("4"), result("5")]),
    ];
    const out = truncateToolResults(messages);
    const first = out[0].content as Extract<ChatMessage["content"], unknown[]>;
    expect((first[0] as { content: string }).content.length).toBeLessThan(2100);
    expect((first[0] as { content: string }).content.endsWith("… [truncated]")).toBe(true);
    // 4 most recent (2..5) untouched
    expect((first[1] as { content: string }).content).toBe(big);
  });
  it("does not mutate the input", () => {
    const messages = [msg([result("1"), result("2"), result("3"), result("4"), result("5")])];
    truncateToolResults(messages);
    const blocks = messages[0].content as { content: string }[];
    expect(blocks[0].content).toBe(big);
  });
  it("short results and string messages pass through", () => {
    const messages = [
      msg("plain"),
      msg([{ type: "tool_result", toolUseId: "1", name: "tap", content: "ok" }]),
    ];
    expect(truncateToolResults(messages)).toEqual(messages);
  });
});

describe("finalAnswerText", () => {
  it("returns string content as-is", () => {
    expect(finalAnswerText(msg("Bonjour"))).toBe("Bonjour");
  });

  it("keeps only the text after the last tool call", () => {
    expect(
      finalAnswerText(
        msg([
          { type: "text", text: "Je regarde l'écran." },
          { type: "tool_use", id: "1", name: "get_screen", input: {} },
          { type: "tool_result", toolUseId: "1", name: "get_screen", content: "…" },
          { type: "text", text: "Le bouton " },
          { type: "text", text: "Login est visible." },
        ]),
      ),
    ).toBe("Le bouton Login est visible.");
  });

  it("is empty when the answer ends on a tool call", () => {
    expect(
      finalAnswerText(msg([{ type: "tool_use", id: "1", name: "get_screen", input: {} }])),
    ).toBe("");
  });
});
