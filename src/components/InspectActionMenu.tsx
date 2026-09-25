// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { ChevronRight, Eye, EyeOff, MousePointerClick, ScrollText } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
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

/** Hover dwell before the selector flyout opens (standard menu feel). */
const SUBMENU_DELAY_MS = 150;
const MENU_W = 232;
const SUBMENU_W = 208;

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
  selectors: Selector[];
  onClose: () => void;
}

/**
 * A context menu floating at (x, y) in viewport coordinates. Each action
 * inserts with the most robust selector on direct click; hovering an action
 * opens a flyout to pick any of the suggested selectors. Closes on Escape
 * (submenu first), outside click, or after an action is inserted.
 */
export function InspectActionMenu({ x, y, node, selectors, onClose }: InspectActionMenuProps) {
  const appendAction = useFlowStore((s) => s.appendAction);
  const ref = useRef<HTMLDivElement | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const [openKind, setOpenKind] = useState<ActionMenuItem["kind"] | null>(null);
  const [focusSubmenu, setFocusSubmenu] = useState(false);

  const best = selectors[0] ?? null;
  const hasSubmenu = selectors.length > 1;

  // Clamp to viewport so the menu doesn't overflow off-screen.
  const style = useMemo(() => {
    const PAD = 8;
    const H = 200; // generous estimate; CSS still wraps if more items added
    const left = Math.min(x, window.innerWidth - MENU_W - PAD);
    const top = Math.min(y, window.innerHeight - H - PAD);
    return { left, top };
  }, [x, y]);

  // Flip the flyout to the left edge when it would overflow the viewport.
  const flipSubmenu = style.left + MENU_W + SUBMENU_W > window.innerWidth - 8;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape closes the flyout first, the whole menu second.
      setOpenKind((k) => {
        if (k !== null) return null;
        onClose();
        return k;
      });
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

  useEffect(
    () => () => {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  const insert = useCallback(
    async (kind: ActionMenuItem["kind"], selector: Selector | null) => {
      if (!selector) {
        toast.error("No selector available", "Pick another element nearby.");
        onClose();
        return;
      }
      try {
        const action: MaestroAction = { kind, selector };
        const text = await ipc.generateCommand(action);
        appendAction(text);
        toast.success("Inserted", text.trim());
      } catch (err) {
        toast.error("Generation failed", err instanceof Error ? err.message : String(err));
      } finally {
        onClose();
      }
    },
    [appendAction, onClose],
  );

  const scheduleOpen = useCallback(
    (kind: ActionMenuItem["kind"]) => {
      if (!hasSubmenu) return;
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => {
        setFocusSubmenu(false);
        setOpenKind(kind);
      }, SUBMENU_DELAY_MS);
    },
    [hasSubmenu],
  );

  const cancelOpen = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);

  // Roving ArrowUp/ArrowDown focus across whichever menuitems are visible.
  const onMenuKeyDown = useCallback((e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const items = Array.from(
      el.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)'),
    );
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "ArrowDown"
        ? items[(idx + 1) % items.length]
        : items[(idx - 1 + items.length) % items.length];
    next?.focus();
  }, []);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 w-58 rounded-md border border-border bg-popover text-popover-foreground shadow-xl"
      style={{ ...style, width: MENU_W }}
      // The menu floats over the device view, whose container drives the inspector
      // (hover on pointer-move, tap on pointer-down, swipe on wheel). Because this
      // menu is a React child of that container, its events bubble up the React tree
      // and would re-trigger the inspector underneath. Stop them at the menu root so
      // interacting with the menu never touches the device/inspector. Menu buttons sit
      // deeper in the tree, so their handlers still fire before this.
      onPointerMove={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onMenuKeyDown}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="rounded-t-md border-b border-border px-3 py-2">
        <div className="truncate text-[11px] font-medium">{nodeLabel(node)}</div>
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {selectorPreview(best)}
        </div>
      </div>
      <ul className="py-1">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const disabled = !best;
          return (
            <li
              key={item.kind}
              className="relative"
              onMouseEnter={() => scheduleOpen(item.kind)}
              onMouseLeave={cancelOpen}
            >
              <button
                type="button"
                role="menuitem"
                disabled={disabled}
                aria-haspopup={hasSubmenu ? "menu" : undefined}
                aria-expanded={hasSubmenu ? openKind === item.kind : undefined}
                onClick={() => void insert(item.kind, best)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" && hasSubmenu) {
                    e.preventDefault();
                    e.stopPropagation();
                    setFocusSubmenu(true);
                    setOpenKind(item.kind);
                  }
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                  disabled ? "cursor-not-allowed text-muted-foreground/50" : "hover:bg-accent",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">{item.label}</span>
                {hasSubmenu ? (
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                ) : null}
              </button>
              {hasSubmenu && openKind === item.kind ? (
                <SelectorSubmenu
                  selectors={selectors}
                  flip={flipSubmenu}
                  focusOnOpen={focusSubmenu}
                  onPick={(sel) => void insert(item.kind, sel)}
                  onCloseSubmenu={() => setOpenKind(null)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Flyout listing every suggested selector for the hovered action. */
function SelectorSubmenu({
  selectors,
  flip,
  focusOnOpen,
  onPick,
  onCloseSubmenu,
}: {
  selectors: Selector[];
  flip: boolean;
  focusOnOpen: boolean;
  onPick: (s: Selector) => void;
  onCloseSubmenu: () => void;
}) {
  const firstRef = useRef<HTMLButtonElement | null>(null);

  // Only steal focus when opened via keyboard (ArrowRight) — a hover-open
  // must not yank focus away from where the user is.
  useEffect(() => {
    if (focusOnOpen) firstRef.current?.focus();
  }, [focusOnOpen]);

  return (
    <ul
      role="menu"
      className={cn(
        "absolute top-0 z-10 rounded-md border border-border bg-popover py-1 shadow-xl",
        flip ? "right-full mr-1" : "left-full ml-1",
      )}
      style={{ width: SUBMENU_W }}
    >
      {selectors.map((s, i) => (
        <li key={s.kind}>
          <button
            ref={i === 0 ? firstRef : undefined}
            type="button"
            role="menuitem"
            onClick={() => onPick(s)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                e.stopPropagation();
                onCloseSubmenu();
              }
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
              {selectorPreview(s)}
            </span>
            {i === 0 ? (
              <span className="shrink-0 text-[9px] text-muted-foreground">recommended</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
