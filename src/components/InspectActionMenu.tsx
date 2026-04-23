import {
  ChevronRight,
  Eye,
  EyeOff,
  MousePointerClick,
  ScrollText,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
} from "react";

import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useFlowStore } from "@/stores/flowStore";
import { toast } from "@/stores/toastStore";
import type { MaestroAction, Selector, UINode } from "@/types";

interface ActionMenuItem {
  label: string;
  icon: ComponentType<{ className?: string }>;
  kind: Extract<
    MaestroAction["kind"],
    "tapOn" | "assertVisible" | "assertNotVisible" | "scrollUntilVisible"
  >;
}

const ITEMS: ActionMenuItem[] = [
  { label: "Tap", icon: MousePointerClick, kind: "tapOn" },
  { label: "Assert visible", icon: Eye, kind: "assertVisible" },
  { label: "Assert not visible", icon: EyeOff, kind: "assertNotVisible" },
  { label: "Scroll until visible", icon: ScrollText, kind: "scrollUntilVisible" },
];

function nodeLabel(n: UINode): string {
  const short = n.class_name.split(".").pop() ?? n.class_name;
  if (n.text) return `"${n.text}"`;
  if (n.resource_id) return n.resource_id.split(/[/:]/).pop() ?? n.resource_id;
  return short;
}

function selectorPreview(s: Selector | null): string {
  if (!s) return "—";
  switch (s.kind) {
    case "resourceId":
      return `id ${s.value.split(/[/:]/).pop() ?? s.value}`;
    case "text":
      return `text "${s.value}"`;
    case "contentDesc":
      return `desc "${s.value}"`;
    case "point":
      return `point ${s.x_pct.toFixed(0)}%, ${s.y_pct.toFixed(0)}%`;
  }
}

export interface InspectActionMenuProps {
  x: number;
  y: number;
  node: UINode;
  selector: Selector | null;
  onClose: () => void;
}

/**
 * A context menu floating at (x, y) in viewport coordinates. Closes on Escape,
 * outside click, or after an action is inserted.
 */
export function InspectActionMenu({
  x,
  y,
  node,
  selector,
  onClose,
}: InspectActionMenuProps) {
  const insertAtCursor = useFlowStore((s) => s.insertAtCursor);
  const ref = useRef<HTMLDivElement | null>(null);

  // Clamp to viewport so the menu doesn't overflow off-screen.
  const style = useMemo(() => {
    const PAD = 8;
    const W = 232;
    const H = 200; // generous estimate; CSS still wraps if more items added
    const left = Math.min(x, window.innerWidth - W - PAD);
    const top = Math.min(y, window.innerHeight - H - PAD);
    return { left, top };
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  const insert = useCallback(
    async (kind: ActionMenuItem["kind"]) => {
      if (!selector) {
        toast.error("No selector available", "Pick another element nearby.");
        onClose();
        return;
      }
      try {
        const action: MaestroAction = { kind, selector };
        const text = await ipc.generateCommand(action);
        const withNewline = text.endsWith("\n") ? text : `${text}\n`;
        insertAtCursor(withNewline);
        toast.success("Inserted", text.trim());
      } catch (err) {
        toast.error(
          "Generation failed",
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        onClose();
      }
    },
    [insertAtCursor, selector, onClose],
  );

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 w-58 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl"
      style={{ ...style, width: 232 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="border-b border-border px-3 py-2">
        <div className="truncate text-[11px] font-medium">
          {nodeLabel(node)}
        </div>
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {selectorPreview(selector)}
        </div>
      </div>
      <ul className="py-1">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const disabled = !selector;
          return (
            <li key={item.kind}>
              <button
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => void insert(item.kind)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                  disabled
                    ? "cursor-not-allowed text-muted-foreground/50"
                    : "hover:bg-accent",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">{item.label}</span>
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
