import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useFlowStore } from "@/stores/flowStore";
import { useInspectorStore } from "@/stores/inspectorStore";
import { toast } from "@/stores/toastStore";
import type { MaestroAction, Selector, UINode } from "@/types";

function selectorLabel(s: Selector): string {
  switch (s.kind) {
    case "resourceId":
      return `id: ${s.value}`;
    case "text":
      return `text: "${s.value}"`;
    case "contentDesc":
      return `desc: "${s.value}"`;
    case "point":
      return `point: ${s.x_pct.toFixed(1)}%, ${s.y_pct.toFixed(1)}%`;
  }
}

function nodeLabel(n: UINode): string {
  const short = n.class_name.split(".").pop() ?? n.class_name;
  if (n.text) return `${short} · "${n.text}"`;
  if (n.resource_id) return `${short} · ${n.resource_id}`;
  return short;
}

function TreeNode({
  node,
  depth,
}: {
  node: UINode;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const selected = useInspectorStore((s) => s.selected?.id === node.id);
  const hovered = useInspectorStore((s) => s.hovered?.id === node.id);
  const select = useInspectorStore((s) => s.select);
  const setHovered = useInspectorStore((s) => s.setHovered);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={cn(
          "group flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[11px]",
          selected && "bg-primary/20",
          !selected && hovered && "bg-accent/40",
          !selected && !hovered && "hover:bg-accent/30",
        )}
        style={{ paddingLeft: depth * 10 + 4 }}
        onClick={() => void select(node)}
        onMouseEnter={() => setHovered(node)}
        onMouseLeave={() => setHovered(null)}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            {open ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="inline-block w-3" />
        )}
        <span className="truncate font-mono">{nodeLabel(node)}</span>
      </div>
      {open && hasChildren
        ? node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} />
          ))
        : null}
    </div>
  );
}

function Properties({ node }: { node: UINode }) {
  const rows: [string, string][] = [
    ["class", node.class_name],
    ["package", node.package],
    ["resource-id", node.resource_id ?? "—"],
    ["text", node.text ?? "—"],
    ["content-desc", node.content_desc ?? "—"],
    [
      "bounds",
      `[${node.bounds.left},${node.bounds.top}] → [${node.bounds.right},${node.bounds.bottom}]`,
    ],
    [
      "flags",
      [
        node.clickable && "clickable",
        node.enabled && "enabled",
        node.focused && "focused",
      ]
        .filter(Boolean)
        .join(", ") || "—",
    ],
  ];
  return (
    <div className="space-y-1 font-mono text-[11px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="w-20 shrink-0 text-muted-foreground">{k}</span>
          <span className="min-w-0 flex-1 break-all">{v}</span>
        </div>
      ))}
    </div>
  );
}

function SelectorCandidates({
  node,
  selectors,
}: {
  node: UINode;
  selectors: Selector[];
}) {
  const insertAtCursor = useFlowStore((s) => s.insertAtCursor);

  const insert = useCallback(
    async (selector: Selector, kind: MaestroAction["kind"]) => {
      let action: MaestroAction;
      if (kind === "tapOn" || kind === "assertVisible") {
        action = { kind, selector };
      } else {
        return;
      }
      try {
        const text = await ipc.generateCommand(action);
        const withNewline = text.endsWith("\n") ? text : `${text}\n`;
        insertAtCursor(withNewline);
        toast.success("Inserted", text.trim());
      } catch (err) {
        toast.error(
          "Generation failed",
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    [insertAtCursor],
  );

  if (selectors.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground">
        No selector suggestions for {nodeLabel(node)}.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {selectors.map((sel, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5 rounded border border-border bg-muted/30 p-1.5"
        >
          <div className="min-w-0 flex-1 truncate font-mono text-[11px]">
            {selectorLabel(sel)}
          </div>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void insert(sel, "tapOn")}
            title="Insert tapOn"
          >
            <Plus className="h-3 w-3" />
            tap
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void insert(sel, "assertVisible")}
            title="Insert assertVisible"
          >
            <Plus className="h-3 w-3" />
            assert
          </Button>
        </div>
      ))}
    </div>
  );
}

export function InspectorPanel() {
  const enabled = useInspectorStore((s) => s.enabled);
  const loading = useInspectorStore((s) => s.loading);
  const tree = useInspectorStore((s) => s.tree);
  const selected = useInspectorStore((s) => s.selected);
  const selectors = useInspectorStore((s) => s.selectors);
  const toggle = useInspectorStore((s) => s.toggle);

  if (!enabled) {
    return (
      <div className="flex h-full flex-col items-start gap-2 p-3 text-[11px] text-muted-foreground">
        <div>
          Press <kbd className="rounded border border-border px-1">I</kbd> to
          inspect the current frame.
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void toggle()}
          disabled={loading}
        >
          {loading ? "Dumping…" : "Enter inspect mode"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Hierarchy
        </div>
        <Button size="xs" variant="ghost" onClick={() => void toggle()}>
          Exit
        </Button>
      </div>
      <div className="min-h-0 flex-1 border-b border-border">
        <ScrollArea className="h-full">
          <div className="p-1.5">
            {tree?.root ? (
              <TreeNode node={tree.root} depth={0} />
            ) : (
              <div className="p-2 text-[11px] text-muted-foreground">
                Empty hierarchy.
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
      <div className="flex max-h-[55%] shrink-0 flex-col gap-3 p-3">
        {selected ? (
          <>
            <Properties node={selected} />
            <SelectorCandidates node={selected} selectors={selectors} />
          </>
        ) : (
          <div className="text-[11px] text-muted-foreground">
            Click a node in the hierarchy or on the device to see properties.
          </div>
        )}
      </div>
    </div>
  );
}
