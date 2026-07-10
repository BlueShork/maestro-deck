// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { ContentBlock } from "@/types/chat";
import { ToolCallCard } from "./ToolCallCard";
import { ChatMessage } from "./ChatMessage";

type ToolUse = Extract<ContentBlock, { type: "tool_use" }>;
type ToolResult = Extract<ContentBlock, { type: "tool_result" }>;

// ── helpers ────────────────────────────────────────────────────────────────

function use(name: string, input: unknown = {}, id = "u1"): ToolUse {
  return { type: "tool_use", id, name, input };
}

function result(
  content: string | { kind: "image"; mediaType: "image/png"; base64: string },
  opts: { isError?: boolean; toolUseId?: string } = {},
): ToolResult {
  return {
    type: "tool_result",
    toolUseId: opts.toolUseId ?? "u1",
    name: "test",
    content,
    isError: opts.isError,
  };
}

// ── tests ───────────────────────────────────────────────────────────────────

describe("ToolCallCard", () => {
  it("shows the running dot and label for get_screen when no result yet", () => {
    const html = renderToStaticMarkup(<ToolCallCard use={use("get_screen")} />);
    expect(html).toMatch(/Lecture de l&#x27;écran|Lecture de l'écran|Lecture de l&#39;écran/);
    // pulsing dot present
    expect(html).toMatch(/animate-pulse/);
    // no result glyph
    expect(html).not.toMatch(/✓|✗/);
    // collapsed by default: aria-expanded="false" and grid-rows:0fr wrapper
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).toMatch(/\[grid-template-rows:0fr\]/);
    // entrance animation class present
    expect(html).toMatch(/motion-safe:animate-in/);
  });

  it("renders ✗ with red classes on isError result; ✓ with green on success", () => {
    const errHtml = renderToStaticMarkup(
      <ToolCallCard use={use("get_screen")} result={result("{}", { isError: true })} />,
    );
    expect(errHtml).toMatch(/✗/);
    expect(errHtml).toMatch(/text-red-/);
    expect(errHtml).not.toMatch(/animate-pulse/);

    const okHtml = renderToStaticMarkup(
      <ToolCallCard use={use("get_screen")} result={result("{}")} />,
    );
    expect(okHtml).toMatch(/✓/);
    expect(okHtml).toMatch(/text-emerald-/);
    expect(okHtml).not.toMatch(/animate-pulse/);
  });

  it('run_flow label contains "exit 0" when result exitCode is 0', () => {
    const r = result(JSON.stringify({ exitCode: 0, output: "ok" }));
    const html = renderToStaticMarkup(
      <ToolCallCard use={use("run_flow", { path: "login.yaml" })} result={r} />,
    );
    expect(html).toMatch(/exit 0/);
  });

  it("renders an <img> with base64 src for image results", () => {
    const imgResult = result({ kind: "image", mediaType: "image/png", base64: "abc123" });
    const html = renderToStaticMarkup(
      <ToolCallCard use={use("take_screenshot")} result={imgResult} />,
    );
    expect(html).toMatch(/<img/);
    expect(html).toMatch(/data:image\/png;base64,abc123/);
  });
});

describe("ChatMessage with block content", () => {
  const assistantBlockMessage = {
    id: "m1",
    role: "assistant" as const,
    content: [
      { type: "text" as const, text: "Hello **world**" },
      { type: "tool_use" as const, id: "u1", name: "get_screen", input: {} },
      {
        type: "tool_result" as const,
        toolUseId: "u1",
        name: "get_screen",
        content: "screen data",
      },
    ] satisfies ContentBlock[],
    createdAt: 0,
  };

  const assistantStringMessage = {
    id: "m2",
    role: "assistant" as const,
    content: "Hello **world**",
    createdAt: 0,
  };

  it("renders markdown text AND a tool card when content is block array", () => {
    const html = renderToStaticMarkup(<ChatMessage message={assistantBlockMessage} />);
    // markdown paragraph rendered
    expect(html).toMatch(/Hello/);
    // button-based tool card present (no details element)
    expect(html).not.toMatch(/<details/);
    expect(html).toMatch(/aria-expanded/);
  });

  it("renders string content exactly as before (markdown paragraph present)", () => {
    const html = renderToStaticMarkup(<ChatMessage message={assistantStringMessage} />);
    expect(html).toMatch(/Hello/);
    // no tool card for string content
    expect(html).not.toMatch(/<details/);
    expect(html).not.toMatch(/aria-expanded/);
  });
});

describe("ToolCallCard input formatting", () => {
  it("renders write_flow content as plain YAML, not escaped JSON", () => {
    const yaml = 'appId: com.example\n---\n- launchApp\n- tapOn: "Login"';
    const html = renderToStaticMarkup(
      <ToolCallCard use={use("write_flow", { path: "login.yaml", content: yaml })} />,
    );
    expect(html).toContain("path: login.yaml");
    expect(html).toContain("- launchApp");
    expect(html).not.toContain("\\n");
    expect(html).not.toContain("&quot;content&quot;");
  });

  it("renders input_text as plain text", () => {
    const html = renderToStaticMarkup(<ToolCallCard use={use("input_text", { text: "a\nb" })} />);
    expect(html).not.toContain("\\n");
  });

  it("still renders other tools' input as pretty JSON", () => {
    const html = renderToStaticMarkup(<ToolCallCard use={use("tap", { x: 1, y: 2 })} />);
    expect(html).toContain("&quot;x&quot;: 1");
  });
});
