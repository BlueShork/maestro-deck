// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/**
 * Generic SSE (Server-Sent Events) reader.
 * Yields JSON-decoded event payloads from a fetch ReadableStream body.
 *
 * Anthropic and Vertex both stream as `data: <json>\n\n` chunks (sometimes
 * preceded by `event: <name>\n`). We surface the parsed JSON; callers
 * project text deltas out of it.
 */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function* flushEvents(rest: string): Generator<unknown> {
    // Normalise CRLF → LF so a single \n\n splitter handles both.
    const normalised = rest.replace(/\r\n/g, "\n");
    const events = normalised.split("\n\n");
    for (const rawEvent of events) {
      if (!rawEvent.trim()) continue;
      const dataLines: string[] = [];
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length === 0) continue;
      const data = dataLines.join("\n");
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data);
      } catch {
        // Keepalive / malformed line — ignore.
      }
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        // Flush whatever's left in the buffer — Vertex sometimes closes
        // the stream without a trailing separator after the final event.
        buffer += decoder.decode();
        yield* flushEvents(buffer);
        return;
      }
      buffer += decoder.decode(value, { stream: true });

      // Process all complete events in buffer (delimited by \n\n or \r\n\r\n).
      const normalised = buffer.replace(/\r\n/g, "\n");
      const lastSep = normalised.lastIndexOf("\n\n");
      if (lastSep === -1) continue;

      const ready = normalised.slice(0, lastSep);
      buffer = normalised.slice(lastSep + 2);
      yield* flushEvents(ready);
    }
  } finally {
    reader.releaseLock();
  }
}
