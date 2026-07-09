// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { openFlowFile } from "@/lib/flow-io";
import { ipc } from "@/lib/ipc";
import { useFlowStore } from "@/stores/flowStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { WorkspaceNode } from "@/types";
import type { ToolSpec } from "@/types/chat";

function requireWorkspace(): string {
  const ws = useWorkspaceStore.getState().folderPath;
  if (!ws) throw new Error("No workspace folder open — ask the user to open one.");
  return ws;
}

function listYaml(node: WorkspaceNode | null, root: string): string[] {
  if (!node) return [];
  const out: string[] = [];
  const walk = (n: WorkspaceNode) => {
    if (n.kind === "file") {
      if (/\.ya?ml$/i.test(n.name)) {
        out.push(
          n.path.startsWith(root) ? n.path.slice(root.length).replace(/^[/\\]/, "") : n.path,
        );
      }
      return;
    }
    n.children.forEach(walk);
  };
  walk(node);
  return out.sort();
}

async function refreshTree(ws: string): Promise<void> {
  try {
    useWorkspaceStore.getState().setTree(await ipc.listWorkspace(ws));
  } catch {
    // Non-fatal: the write succeeded, only the tree view is stale.
  }
}

export const tools = [
  {
    spec: {
      name: "list_flows",
      description:
        "List all Maestro flow files (.yaml/.yml) in the workspace, one relative path per line.",
      inputSchema: { type: "object", properties: {}, required: [] },
    } satisfies ToolSpec,
    execute: async (): Promise<string> => {
      const ws = requireWorkspace();
      const paths = listYaml(useWorkspaceStore.getState().tree, ws);
      return paths.length ? paths.join("\n") : "(no flow files)";
    },
  },
  {
    spec: {
      name: "read_flow",
      description: "Read a flow file. Path is relative to the workspace root.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "e.g. login.yaml or sub/steps.yaml" } },
        required: ["path"],
      },
    } satisfies ToolSpec,
    execute: async (input: { path: string }): Promise<string> => {
      return ipc.readWorkspaceFile(requireWorkspace(), input.path);
    },
  },
  {
    spec: {
      name: "write_flow",
      description:
        "Create or overwrite a flow file with the given full YAML content. Path is relative to the workspace root and must end in .yaml or .yml.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    } satisfies ToolSpec,
    execute: async (input: { path: string; content: string }): Promise<string> => {
      const ws = requireWorkspace();
      await ipc.writeWorkspaceFile(ws, input.path, input.content);
      await refreshTree(ws);
      // If the written file is open in the editor, reload the buffer so the
      // user sees Billy's change immediately (same as the Apply path).
      const sep = ws.includes("\\") && !ws.includes("/") ? "\\" : "/";
      const abs = ws.endsWith(sep) ? ws + input.path : ws + sep + input.path;
      const open = useFlowStore.getState().filePath;
      if (open && open === abs) await openFlowFile(abs, { silent: true });
      return "written";
    },
  },
];
