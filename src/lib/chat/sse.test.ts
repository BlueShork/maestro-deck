import { describe, it, expect } from "vitest";
import { readSSE } from "./sse";

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i < chunks.length) {
        ctrl.enqueue(enc.encode(chunks[i++]));
      } else {
        ctrl.close();
      }
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const ev of readSSE(stream)) out.push(ev);
  return out;
}

describe("readSSE", () => {
  it("parses a single complete event", async () => {
    const events = await collect(streamFrom([`data: {"a":1}\n\n`]));
    expect(events).toEqual([{ a: 1 }]);
  });

  it("parses multiple events split across chunks", async () => {
    const events = await collect(streamFrom([`data: {"a":1`, `}\n\ndata: {"b":2}\n\n`]));
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("handles CRLF line endings", async () => {
    const events = await collect(streamFrom([`data: {"a":1}\r\n\r\n`]));
    expect(events).toEqual([{ a: 1 }]);
  });

  it("ignores event: prefix lines and surfaces only data:", async () => {
    const events = await collect(streamFrom([`event: message\ndata: {"x":true}\n\n`]));
    expect(events).toEqual([{ x: true }]);
  });

  it("stops on [DONE] sentinel", async () => {
    const events = await collect(
      streamFrom([`data: {"a":1}\n\ndata: [DONE]\n\ndata: {"never":1}\n\n`]),
    );
    expect(events).toEqual([{ a: 1 }]);
  });

  it("flushes a final event without trailing separator on stream close", async () => {
    const events = await collect(streamFrom([`data: {"tail":true}`]));
    expect(events).toEqual([{ tail: true }]);
  });

  it("ignores keepalive / malformed json events silently", async () => {
    const events = await collect(streamFrom([`data: not-json\n\ndata: {"ok":1}\n\n`]));
    expect(events).toEqual([{ ok: 1 }]);
  });

  it("joins multi-line data fields with newlines", async () => {
    const events = await collect(streamFrom([`data: {"x":\ndata: 42}\n\n`]));
    expect(events).toEqual([{ x: 42 }]);
  });

  it("yields nothing for empty stream", async () => {
    const events = await collect(streamFrom([]));
    expect(events).toEqual([]);
  });
});
