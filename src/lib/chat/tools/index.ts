// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { ImagePart, ToolSpec } from "@/types/chat";

import { tools as fileTools } from "./files";
import { tools as inputTools } from "./input";
import { tools as runTools } from "./run";
import { tools as screenTools } from "./screen";

interface ToolImpl {
  spec: ToolSpec;
  execute: (input: never, signal?: AbortSignal) => Promise<string | ImagePart>;
}

const registry = new Map<string, ToolImpl>(
  [...screenTools, ...inputTools, ...fileTools, ...runTools].map((t) => [
    t.spec.name,
    t as ToolImpl,
  ]),
);

export const ALL_TOOLS: ToolSpec[] = [...registry.values()].map((t) => t.spec);

/** Execute a tool by name. Never throws: failures come back as isError
 *  results so the agent loop can hand them to the model. */
export async function executeTool(
  name: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<{ content: string | ImagePart; isError: boolean }> {
  const tool = registry.get(name);
  if (!tool) return { content: `Unknown tool: ${name}`, isError: true };
  try {
    const content = await tool.execute((input ?? {}) as never, signal);
    return { content, isError: false };
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
