// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const storage = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: (k: string) => {
      storage.delete(k);
    },
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

vi.mock("@/lib/chat/registry", () => ({ getProvider: vi.fn() }));

import type { ChatProvider } from "@/lib/chat/provider";
import type { ChatMessage, ContentBlock, ProviderEvent } from "@/types/chat";

const { getProvider } = await import("@/lib/chat/registry");
const { MAESTRODECK_MODEL } = await import("@/lib/chat/models");
const { useChatStore } = await import("./chatStore");
const { useFlowStore } = await import("./flowStore");
const { useWorkspaceStore } = await import("./workspaceStore");

const provider = vi.mocked(getProvider);

/** A provider that answers with a fixed script and records what it was sent. */
function scripted(events: ProviderEvent[]) {
  const seen: ChatMessage[][] = [];
  const p: ChatProvider = {
    id: "maestrodeck",
    listModels: () => [],
    async *stream({ messages }) {
      seen.push(messages);
      yield* events;
    },
  };
  return { p, seen };
}

const ANSWER: ProviderEvent[] = [
  { type: "text_delta", text: "Tap " },
  { type: "text_delta", text: "Login." },
  { type: "stop", reason: "end_turn" },
];

/** Everything the model was told besides the conversation itself. */
const context = (sent: ChatMessage[]) =>
  sent
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");

beforeEach(() => {
  provider.mockReset();
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    error: null,
    abort: null,
    currentProvider: "maestrodeck",
    currentModel: MAESTRODECK_MODEL.id,
  });
  useFlowStore.setState({ content: "", filePath: null });
  useWorkspaceStore.setState({ folderPath: null, tree: null });
});

describe("chatStore defaults", () => {
  it("starts a fresh install on Billy from Maestro Deck Cloud, which needs no key", async () => {
    localStorage.clear();
    vi.resetModules();
    const fresh = await import("./chatStore");
    const s = fresh.useChatStore.getState();
    expect(s.currentProvider).toBe("maestrodeck");
    expect(s.currentModel).toBe(MAESTRODECK_MODEL.id);
  });
});

describe("sendMessage", () => {
  it("ignores a blank message", async () => {
    await expect(useChatStore.getState().sendMessage("   ")).resolves.toBeNull();
    expect(provider).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("asks a signed-out user to sign in when Billy is on Maestro Deck Cloud", async () => {
    provider.mockResolvedValue(null);

    await expect(useChatStore.getState().sendMessage("Hi")).resolves.toBeNull();

    expect(useChatStore.getState().error).toMatch(/Sign in to your Maestro Deck account/);
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("points a BYOK user without a key to Settings instead", async () => {
    useChatStore.setState({ currentProvider: "anthropic" });
    provider.mockResolvedValue(null);

    await useChatStore.getState().sendMessage("Hi");

    expect(useChatStore.getState().error).toMatch(/No credentials configured/);
  });

  it("resolves with the id of the finished answer, holding the streamed text", async () => {
    provider.mockResolvedValue(scripted(ANSWER).p);

    const id = await useChatStore.getState().sendMessage("  How do I log in?  ");

    const { messages, isStreaming } = useChatStore.getState();
    expect(isStreaming).toBe(false);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "How do I log in?"],
      ["assistant", "Tap Login."],
    ]);
    expect(id).toBe(messages[1].id);
  });

  it("flags a spoken question and tells Billy its answer will be read aloud", async () => {
    const { p, seen } = scripted(ANSWER);
    provider.mockResolvedValue(p);

    await useChatStore.getState().sendMessage("How do I log in?", { viaVoice: true });

    expect(useChatStore.getState().messages[0].viaVoice).toBe(true);
    expect(context(seen[0])).toMatch(/read aloud/);
  });

  it("does not ask for a spoken answer when the question was typed", async () => {
    const { p, seen } = scripted(ANSWER);
    provider.mockResolvedValue(p);

    await useChatStore.getState().sendMessage("How do I log in?");

    expect(useChatStore.getState().messages[0].viaVoice).toBeUndefined();
    expect(context(seen[0])).not.toMatch(/read aloud/);
  });

  it("shows Billy the open file and the workspace's flows relative to its root", async () => {
    const { p, seen } = scripted(ANSWER);
    provider.mockResolvedValue(p);
    useFlowStore.setState({
      content: "appId: com.example\n---\n- launchApp",
      filePath: "/ws/login.yaml",
    });
    useWorkspaceStore.setState({
      folderPath: "/ws",
      tree: {
        kind: "dir",
        name: "ws",
        path: "/ws",
        children: [
          { kind: "file", name: "login.yaml", path: "/ws/login.yaml" },
          { kind: "file", name: "README.md", path: "/ws/README.md" },
          {
            kind: "dir",
            name: "sub",
            path: "/ws/sub",
            children: [{ kind: "file", name: "a.yml", path: "/ws/sub/a.yml" }],
          },
        ],
      } as never,
    });

    await useChatStore.getState().sendMessage("Hi");

    const ctx = context(seen[0]);
    expect(ctx).toContain("- login.yaml");
    expect(ctx).toContain("- sub/a.yml");
    expect(ctx).not.toContain("README.md");
    expect(ctx).toContain("appId: com.example");
  });

  it("drops the empty answer and surfaces the error when the provider fails", async () => {
    provider.mockResolvedValue({
      id: "maestrodeck",
      listModels: () => [],
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error("Billy couldn't answer right now (HTTP 500).");
      },
    });

    await expect(useChatStore.getState().sendMessage("Hi")).resolves.toBeNull();

    const s = useChatStore.getState();
    expect(s.error).toBe("Billy couldn't answer right now (HTTP 500).");
    expect(s.messages.map((m) => m.role)).toEqual(["user"]);
    expect(s.isStreaming).toBe(false);
  });

  it("keeps a stopped answer, marked as stopped, and resolves with null", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    provider.mockResolvedValue({
      id: "maestrodeck",
      listModels: () => [],
      async *stream({ signal }) {
        yield { type: "text_delta", text: "Partial" };
        await gate;
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      },
    });

    const pending = useChatStore.getState().sendMessage("Hi");
    await vi.waitFor(() => expect(useChatStore.getState().messages[1]?.content).toBe("Partial"));
    useChatStore.getState().cancel();
    release();

    await expect(pending).resolves.toBeNull();
    const answer = useChatStore.getState().messages[1];
    expect(answer.content).toBe("Partial\n\n_[stopped]_");
    expect(useChatStore.getState().error).toBeNull();
  });

  it("resolves with null when a stop ends the stream without an error", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    provider.mockResolvedValue({
      id: "maestrodeck",
      listModels: () => [],
      async *stream() {
        yield { type: "text_delta", text: "Partial" };
        await gate;
      },
    });

    const pending = useChatStore.getState().sendMessage("Hi");
    await vi.waitFor(() => expect(useChatStore.getState().isStreaming).toBe(true));
    useChatStore.getState().cancel();
    release();

    await expect(pending).resolves.toBeNull();
  });

  it("refuses a second message while an answer is streaming", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    provider.mockResolvedValue({
      id: "maestrodeck",
      listModels: () => [],
      async *stream() {
        await gate;
        yield { type: "stop", reason: "end_turn" };
      },
    });

    const first = useChatStore.getState().sendMessage("One");
    await vi.waitFor(() => expect(useChatStore.getState().isStreaming).toBe(true));

    await expect(useChatStore.getState().sendMessage("Two")).resolves.toBeNull();
    release();
    await first;

    expect(useChatStore.getState().messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("records a tool call and its result between the text around them", async () => {
    const turns: ProviderEvent[][] = [
      [
        { type: "text_delta", text: "Looking." },
        { type: "tool_use", id: "t1", name: "no_such_tool", input: {} },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "Do" },
        { type: "text_delta", text: "ne." },
        { type: "stop", reason: "end_turn" },
      ],
    ];
    let turn = 0;
    provider.mockResolvedValue({
      id: "maestrodeck",
      listModels: () => [],
      async *stream() {
        yield* turns[turn++];
      },
    });

    await useChatStore.getState().sendMessage("Hi");

    const blocks = useChatStore.getState().messages[1].content as ContentBlock[];
    expect(blocks).toEqual([
      { type: "text", text: "Looking." },
      { type: "tool_use", id: "t1", name: "no_such_tool", input: {} },
      expect.objectContaining({ type: "tool_result", toolUseId: "t1", isError: true }),
      { type: "text", text: "Done." },
    ]);
  });
});
