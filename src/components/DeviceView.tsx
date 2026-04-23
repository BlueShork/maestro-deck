import { Smartphone } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { InspectActionMenu } from "@/components/InspectActionMenu";
import { H264Decoder } from "@/lib/decoder";
import { events, ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useDeviceStore } from "@/stores/deviceStore";
import { useInspectorStore } from "@/stores/inspectorStore";
import { useStreamStore } from "@/stores/streamStore";
import { toast } from "@/stores/toastStore";
import type { Bounds, Selector, UINode } from "@/types";

function nodeArea(n: UINode): number {
  const w = n.bounds.right - n.bounds.left;
  const h = n.bounds.bottom - n.bounds.top;
  return Math.max(0, w) * Math.max(0, h);
}

function contains(n: UINode, x: number, y: number): boolean {
  const { bounds } = n;
  return (
    x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
  );
}

function isTargetable(n: UINode): boolean {
  return (
    !!n.text?.trim() ||
    !!n.resource_id?.trim() ||
    !!n.content_desc?.trim() ||
    n.clickable
  );
}

/**
 * Walk the full tree and return the best node containing (x, y). "Best" = the
 * smallest-area node, but with a preference for nodes that have a usable
 * selector (text / resource-id / content-desc / clickable). Falls back to the
 * smallest raw match if no targetable candidate exists.
 *
 * We walk unconditionally instead of pruning on "does parent contain point"
 * because Maestro 2.0 returns the root with empty attributes → bounds parse
 * to [0,0][0,0], which would cut the descent and return null.
 */
function findSmallestAt(root: UINode, x: number, y: number): UINode | null {
  let bestTargetable: UINode | null = null;
  let bestTargetableArea = Infinity;
  let bestAny: UINode | null = null;
  let bestAnyArea = Infinity;
  const stack: UINode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (contains(n, x, y)) {
      const area = nodeArea(n);
      if (area > 0 && area < bestAnyArea) {
        bestAny = n;
        bestAnyArea = area;
      }
      if (area > 0 && area < bestTargetableArea && isTargetable(n)) {
        bestTargetable = n;
        bestTargetableArea = area;
      }
    }
    for (const c of n.children) stack.push(c);
  }
  return bestTargetable ?? bestAny;
}

function useFrameStream(canvasRef: RefObject<HTMLCanvasElement>) {
  const pushFrame = useStreamStore((s) => s.pushFrame);
  const pendingRef = useRef<VideoFrame | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const drawNext = () => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      const frame = pendingRef.current;
      pendingRef.current = null;
      if (!frame) return;
      if (!canvas) {
        frame.close();
        return;
      }
      const w = frame.displayWidth || frame.codedWidth;
      const h = frame.displayHeight || frame.codedHeight;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        frame.close();
        return;
      }
      ctx.drawImage(frame, 0, 0);
      pushFrame({ width: w, height: h });
      frame.close();
    };

    const decoder = new H264Decoder({
      onFrame: (frame) => {
        // Coalesce: if a frame is already queued for the next paint, drop it
        // in favor of the newest one to keep latency low.
        if (pendingRef.current) {
          pendingRef.current.close();
        }
        pendingRef.current = frame;
        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(drawNext);
        }
      },
      onError: (err) => {
        toast.error("Decoder error", err.message);
      },
    });

    void events
      .onFrame((payload) => {
        decoder.feed(payload);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (pendingRef.current) {
        pendingRef.current.close();
        pendingRef.current = null;
      }
      decoder.close();
    };
  }, [canvasRef, pushFrame]);
}

export function DeviceView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasRect, setCanvasRect] = useState({ width: 0, height: 0 });

  const current = useDeviceStore((s) => s.current);
  const hasFrame = useStreamStore((s) => s.hasFrame);
  const streamW = useStreamStore((s) => s.width);
  const streamH = useStreamStore((s) => s.height);
  const inspectEnabled = useInspectorStore((s) => s.enabled);
  const tree = useInspectorStore((s) => s.tree);
  const hovered = useInspectorStore((s) => s.hovered);
  const setHovered = useInspectorStore((s) => s.setHovered);
  const select = useInspectorStore((s) => s.select);

  const [actionMenu, setActionMenu] = useState<{
    x: number;
    y: number;
    node: UINode;
    selector: Selector | null;
  } | null>(null);

  useFrameStream(canvasRef);

  const deviceWidth = streamW || current?.screen_width || 1080;
  const deviceHeight = streamH || current?.screen_height || 2340;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setCanvasRect({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = Math.min(
    canvasRect.width / deviceWidth || 0,
    canvasRect.height / deviceHeight || 0,
  );
  const displayW = deviceWidth * scale;
  const displayH = deviceHeight * scale;

  // Maestro hierarchy returns bounds in the device's *native* resolution,
  // which can differ from scrcpy's downscaled stream (scrcpy is capped to
  // max_size=1080, while a Galaxy S24 Ultra is natively 1440×3120). Detect
  // the hierarchy coordinate space from the tree itself so overlays line up
  // and hit-tests resolve to the right element.
  const hierarchyDims = useMemo(() => {
    if (!tree?.root) return null;
    let w = 0;
    let h = 0;
    const stack: UINode[] = [tree.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.bounds.right > w) w = n.bounds.right;
      if (n.bounds.bottom > h) h = n.bounds.bottom;
      for (const c of n.children) stack.push(c);
    }
    return w > 0 && h > 0 ? { w, h } : null;
  }, [tree]);

  const overlayScaleX = hierarchyDims ? displayW / hierarchyDims.w : scale;
  const overlayScaleY = hierarchyDims ? displayH / hierarchyDims.h : scale;
  // Stream → hierarchy ratio; used to convert local pointer coords (stream
  // space) into the coords expected by `findSmallestAt` and `query_element`.
  const hierToStreamX = hierarchyDims ? hierarchyDims.w / deviceWidth : 1;
  const hierToStreamY = hierarchyDims ? hierarchyDims.h / deviceHeight : 1;

  const toDeviceCoords = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const offsetX = (rect.width - displayW) / 2;
      const offsetY = (rect.height - displayH) / 2;
      const localX = clientX - rect.left - offsetX;
      const localY = clientY - rect.top - offsetY;
      if (
        localX < 0 ||
        localY < 0 ||
        localX > displayW ||
        localY > displayH ||
        scale === 0
      ) {
        return null;
      }
      return {
        // Stream-space pixels — what scrcpy expects for input events.
        x: Math.round(localX / scale),
        y: Math.round(localY / scale),
      };
    },
    [displayW, displayH, scale],
  );

  const toHierarchyCoords = useCallback(
    (streamX: number, streamY: number) => ({
      x: Math.round(streamX * hierToStreamX),
      y: Math.round(streamY * hierToStreamY),
    }),
    [hierToStreamX, hierToStreamY],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!inspectEnabled || !tree?.root) return;
      const coords = toDeviceCoords(e.clientX, e.clientY);
      if (!coords) {
        setHovered(null);
        return;
      }
      const h = toHierarchyCoords(coords.x, coords.y);
      const hit = findSmallestAt(tree.root, h.x, h.y);
      setHovered(hit);
    },
    [inspectEnabled, tree, toDeviceCoords, toHierarchyCoords, setHovered],
  );

  const onClick = useCallback(
    async (e: ReactPointerEvent) => {
      // Only react to primary (left) button. Right-click is handled by
      // onContextMenu so we don't accidentally tap on a right-click.
      if (e.button !== 0) return;
      const coords = toDeviceCoords(e.clientX, e.clientY);
      if (!coords) return;
      if (!current) return;
      // Tap the device first so the user sees their input applied immediately,
      // then resolve the element under the cursor for the inspector panel.
      try {
        await ipc.sendInput({ kind: "tap", x: coords.x, y: coords.y });
      } catch (err) {
        toast.error(
          "Tap failed",
          err instanceof Error ? err.message : String(err),
        );
        return;
      }
      if (inspectEnabled) {
        try {
          const h = toHierarchyCoords(coords.x, coords.y);
          const node = await ipc.queryElement(h.x, h.y);
          await select(node);
        } catch (err) {
          toast.error(
            "Query failed",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    },
    [toDeviceCoords, toHierarchyCoords, inspectEnabled, select, current],
  );

  const onContextMenu = useCallback(
    async (e: ReactMouseEvent) => {
      if (!inspectEnabled) return;
      const coords = toDeviceCoords(e.clientX, e.clientY);
      if (!coords) return;
      e.preventDefault();
      try {
        const h = toHierarchyCoords(coords.x, coords.y);
        const node = await ipc.queryElement(h.x, h.y);
        if (!node) {
          toast.error("No element here", "Try near a UI block.");
          return;
        }
        await select(node);
        const selectors = await ipc.suggestSelectors(node);
        setActionMenu({
          x: e.clientX,
          y: e.clientY,
          node,
          selector: selectors[0] ?? null,
        });
      } catch (err) {
        toast.error(
          "Inspect failed",
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    [inspectEnabled, toDeviceCoords, toHierarchyCoords, select],
  );

  // Close the menu when the user leaves inspect mode.
  useEffect(() => {
    if (!inspectEnabled) setActionMenu(null);
  }, [inspectEnabled]);

  const overlayBounds: Bounds | null = hovered?.bounds ?? null;

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHovered(null)}
      onPointerDown={(e) => void onClick(e)}
      onContextMenu={(e) => void onContextMenu(e)}
    >
      {hasFrame ? null : <EmptyState connected={!!current} />}

      <canvas
        ref={canvasRef}
        className={cn(
          "pointer-events-none rounded-lg bg-black shadow-2xl",
          !hasFrame && "hidden",
          inspectEnabled && "cursor-crosshair",
        )}
        style={{
          width: displayW || undefined,
          height: displayH || undefined,
        }}
      />

      {inspectEnabled && overlayBounds && scale > 0 ? (
        <div
          className="pointer-events-none absolute border-2 border-red-500 bg-red-500/15 shadow-[0_0_0_1px_rgba(239,68,68,0.35),0_0_14px_rgba(239,68,68,0.45)]"
          style={{
            left:
              (canvasRect.width - displayW) / 2 +
              overlayBounds.left * overlayScaleX,
            top:
              (canvasRect.height - displayH) / 2 +
              overlayBounds.top * overlayScaleY,
            width:
              (overlayBounds.right - overlayBounds.left) * overlayScaleX,
            height:
              (overlayBounds.bottom - overlayBounds.top) * overlayScaleY,
          }}
        />
      ) : null}

      {actionMenu ? (
        <InspectActionMenu
          x={actionMenu.x}
          y={actionMenu.y}
          node={actionMenu.node}
          selector={actionMenu.selector}
          onClose={() => setActionMenu(null)}
        />
      ) : null}
    </div>
  );
}

function EmptyState({ connected }: { connected: boolean }) {
  return (
    <div className="pointer-events-none flex aspect-[9/19.5] max-h-full w-auto flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-background/60 p-6 text-center">
      <Smartphone className="h-10 w-10 text-muted-foreground/60" />
      <div className="text-sm font-medium">
        {connected ? "Waiting for frames…" : "No device connected"}
      </div>
      <div className="max-w-[16rem] text-xs text-muted-foreground">
        {connected
          ? "The stream will appear here once scrcpy pushes the first frame."
          : "Plug in an Android device with USB debugging enabled, then pick it in the sidebar."}
      </div>
    </div>
  );
}
