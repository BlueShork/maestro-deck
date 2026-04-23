import { Smartphone } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { H264Decoder } from "@/lib/decoder";
import { events, ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useDeviceStore } from "@/stores/deviceStore";
import { useInspectorStore } from "@/stores/inspectorStore";
import { useStreamStore } from "@/stores/streamStore";
import { toast } from "@/stores/toastStore";
import type { Bounds, UINode } from "@/types";

function findLeafAt(node: UINode, x: number, y: number): UINode | null {
  const { bounds } = node;
  if (
    x < bounds.left ||
    x > bounds.right ||
    y < bounds.top ||
    y > bounds.bottom
  ) {
    return null;
  }
  for (const child of node.children) {
    const hit = findLeafAt(child, x, y);
    if (hit) return hit;
  }
  return node;
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
        x: Math.round(localX / scale),
        y: Math.round(localY / scale),
      };
    },
    [displayW, displayH, scale],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!inspectEnabled || !tree?.root) return;
      const coords = toDeviceCoords(e.clientX, e.clientY);
      if (!coords) {
        setHovered(null);
        return;
      }
      const hit = findLeafAt(tree.root, coords.x, coords.y);
      setHovered(hit);
    },
    [inspectEnabled, tree, toDeviceCoords, setHovered],
  );

  const onClick = useCallback(
    async (e: ReactPointerEvent) => {
      const coords = toDeviceCoords(e.clientX, e.clientY);
      if (!coords) return;
      if (inspectEnabled) {
        try {
          const node = await ipc.queryElement(coords.x, coords.y);
          await select(node);
        } catch (err) {
          toast.error(
            "Query failed",
            err instanceof Error ? err.message : String(err),
          );
        }
        return;
      }
      if (!current) return;
      try {
        await ipc.sendInput({ kind: "tap", x: coords.x, y: coords.y });
      } catch (err) {
        toast.error(
          "Tap failed",
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    [toDeviceCoords, inspectEnabled, select, current],
  );

  const overlayBounds: Bounds | null = hovered?.bounds ?? null;

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHovered(null)}
      onPointerDown={(e) => void onClick(e)}
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
          className="pointer-events-none absolute border-2 border-primary/80 bg-primary/15"
          style={{
            left:
              (canvasRect.width - displayW) / 2 + overlayBounds.left * scale,
            top:
              (canvasRect.height - displayH) / 2 + overlayBounds.top * scale,
            width: (overlayBounds.right - overlayBounds.left) * scale,
            height: (overlayBounds.bottom - overlayBounds.top) * scale,
          }}
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
