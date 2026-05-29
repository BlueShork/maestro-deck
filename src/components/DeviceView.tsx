// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Channel } from "@tauri-apps/api/core";
import { exists, mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { Camera, House, Moon, Smartphone, Sun } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { InspectActionMenu } from "@/components/InspectActionMenu";
import { H264Decoder } from "@/lib/decoder";
import { events, ipc } from "@/lib/ipc";
import { useShortcuts } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { useDeviceStore } from "@/stores/deviceStore";
import { useInspectorStore } from "@/stores/inspectorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useStreamStore } from "@/stores/streamStore";
import { toast } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { Bounds, Selector, UINode } from "@/types";

function nodeArea(n: UINode): number {
  const w = n.bounds.right - n.bounds.left;
  const h = n.bounds.bottom - n.bounds.top;
  return Math.max(0, w) * Math.max(0, h);
}

function contains(n: UINode, x: number, y: number): boolean {
  const { bounds } = n;
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function isTargetable(n: UINode): boolean {
  return !!n.text?.trim() || !!n.resource_id?.trim() || !!n.content_desc?.trim() || n.clickable;
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

function useScreenshotStream(canvasRef: RefObject<HTMLCanvasElement>) {
  const pushFrame = useStreamStore((s) => s.pushFrame);
  const pendingRef = useRef<ImageBitmap | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let cancelled = false;

    const drawNext = () => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      const bmp = pendingRef.current;
      pendingRef.current = null;
      if (!bmp) return;
      if (!canvas) {
        bmp.close();
        return;
      }
      if (canvas.width !== bmp.width) canvas.width = bmp.width;
      if (canvas.height !== bmp.height) canvas.height = bmp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bmp.close();
        return;
      }
      ctx.drawImage(bmp, 0, 0);
      pushFrame({ width: bmp.width, height: bmp.height });
      bmp.close();
    };

    // iOS and web both deliver PNG screenshots; only the connected platform's
    // poller emits, so subscribing to both events is safe.
    const onShot = async (payload: { data: Uint8Array }) => {
      try {
        // Copy the exact view region into a fresh buffer: robust if `data`
        // is ever a subarray, and yields a concrete-buffer typed array that
        // satisfies BlobPart without an `as` cast.
        const blob = new Blob([new Uint8Array(payload.data)], { type: "image/png" });
        const bmp = await createImageBitmap(blob);
        if (cancelled) {
          bmp.close();
          return;
        }
        if (pendingRef.current) pendingRef.current.close();
        pendingRef.current = bmp;
        if (rafRef.current === null) rafRef.current = requestAnimationFrame(drawNext);
      } catch {
        // Ignore a single bad frame; the next poll replaces it.
      }
    };

    const subscribe = (fn: Promise<() => void>) =>
      void fn.then((un) => (cancelled ? un() : unlistens.push(un)));
    subscribe(events.onIosFrame(onShot));
    subscribe(events.onWebFrame(onShot));

    return () => {
      cancelled = true;
      unlistens.forEach((un) => un());
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (pendingRef.current) {
        pendingRef.current.close();
        pendingRef.current = null;
      }
    };
  }, [canvasRef, pushFrame]);
}

function useSckStream(canvasRef: RefObject<HTMLCanvasElement>, enabled: boolean) {
  const pushFrame = useStreamStore((s) => s.pushFrame);
  const pendingRef = useRef<{ w: number; h: number; rgba: Uint8ClampedArray<ArrayBuffer> } | null>(
    null,
  );
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const drawNext = () => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      const frame = pendingRef.current;
      pendingRef.current = null;
      if (!frame || !canvas) return;
      if (canvas.width !== frame.w) canvas.width = frame.w;
      if (canvas.height !== frame.h) canvas.height = frame.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.putImageData(new ImageData(frame.rgba, frame.w, frame.h), 0, 0);
      pushFrame({ width: frame.w, height: frame.h });
    };

    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = (buf) => {
      if (cancelled || buf.byteLength < 8) return;
      const view = new DataView(buf);
      const w = view.getUint32(0, true);
      const h = view.getUint32(4, true);
      const rawRgba = new Uint8ClampedArray(buf, 8);
      if (rawRgba.length !== w * h * 4) return; // guard against a malformed frame
      // Copy into a plain ArrayBuffer-backed clamped array so ImageData accepts it.
      const rgba = new Uint8ClampedArray(rawRgba);
      pendingRef.current = { w, h, rgba };
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(drawNext);
    };

    // Fire-and-forget: false just means we stay on the screenshot path.
    void ipc.upgradeIosPreviewToSck(channel).catch(() => {});

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      pendingRef.current = null;
      // Backend tears the SCK session down on disconnect/start_stream.
    };
  }, [canvasRef, enabled, pushFrame]);
}

export function DeviceView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasRect, setCanvasRect] = useState({ width: 0, height: 0 });

  const current = useDeviceStore((s) => s.current);
  const hasFrame = useStreamStore((s) => s.hasFrame);
  const streamW = useStreamStore((s) => s.width);
  const streamH = useStreamStore((s) => s.height);
  const streamEnabled = useSettingsStore((s) => s.streamEnabled);
  const inspectEnabled = useInspectorStore((s) => s.enabled);
  const tree = useInspectorStore((s) => s.tree);
  const hovered = useInspectorStore((s) => s.hovered);
  const setHovered = useInspectorStore((s) => s.setHovered);
  const select = useInspectorStore((s) => s.select);
  const scheduleAutoRefresh = useInspectorStore((s) => s.scheduleAutoRefresh);
  const refreshIfStale = useInspectorStore((s) => s.refreshIfStale);

  const [actionMenu, setActionMenu] = useState<{
    x: number;
    y: number;
    node: UINode;
    selector: Selector | null;
  } | null>(null);

  // Dark-mode toggle is an Android-only `adb` feature; hidden for iOS and web.
  const noDarkMode = current?.platform !== "android";
  // Both hooks mount unconditionally (Rules of Hooks). They listen to
  // different events (`frame` / `ios_frame` / `web_frame`), so only the
  // connected platform actually paints — the Android H.264 hook is unchanged.
  useFrameStream(canvasRef);
  useScreenshotStream(canvasRef);
  useSckStream(canvasRef, current?.platform === "ios" && streamEnabled);

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
      if (localX < 0 || localY < 0 || localX > displayW || localY > displayH || scale === 0) {
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
      // Catch manual navigation on the physical phone — if the cached
      // tree is older than STALE_TREE_MS, trigger a refresh. Cheap:
      // internally guarded against re-entry and against trees younger
      // than the threshold, so calling on every mouse move is fine.
      refreshIfStale();
      const h = toHierarchyCoords(coords.x, coords.y);
      const hit = findSmallestAt(tree.root, h.x, h.y);
      setHovered(hit);
    },
    [inspectEnabled, tree, toDeviceCoords, toHierarchyCoords, setHovered, refreshIfStale],
  );

  const onClick = useCallback(
    async (e: ReactPointerEvent) => {
      // Only react to primary (left) button. Right-click is handled by
      // onContextMenu so we don't accidentally tap on a right-click.
      if (e.button !== 0) return;
      const coords = toDeviceCoords(e.clientX, e.clientY);
      if (!coords) return;
      if (!current) return;
      // Coords are in stream space (what scrcpy mirrors). Pass the matching
      // dimensions so the device-side scrcpy server scales the tap correctly,
      // even when the device's native resolution differs (QHD+ → 1440 native
      // vs 1080 stream).
      try {
        await ipc.sendInput({ kind: "tap", x: coords.x, y: coords.y }, deviceWidth, deviceHeight);
        toast.action("Tap sent");
      } catch (err) {
        toast.error("Tap failed", err instanceof Error ? err.message : String(err));
        return;
      }
      if (inspectEnabled) {
        try {
          const h = toHierarchyCoords(coords.x, coords.y);
          const node = await ipc.queryElement(h.x, h.y);
          await select(node);
        } catch (err) {
          toast.error("Query failed", err instanceof Error ? err.message : String(err));
        }
        // Tap may have navigated; schedule a debounced re-dump so the
        // hierarchy reflects whatever is now on screen. Rapid taps
        // collapse to a single dump at the end of the burst.
        scheduleAutoRefresh();
      }
    },
    [
      toDeviceCoords,
      toHierarchyCoords,
      inspectEnabled,
      select,
      current,
      deviceWidth,
      deviceHeight,
      scheduleAutoRefresh,
    ],
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
        toast.error("Inspect failed", err instanceof Error ? err.message : String(err));
      }
    },
    [inspectEnabled, toDeviceCoords, toHierarchyCoords, select],
  );

  // Close the menu when the user leaves inspect mode.
  useEffect(() => {
    if (!inspectEnabled) setActionMenu(null);
  }, [inspectEnabled]);

  // Device-side dark-mode toggle. We mirror the device state locally
  // so the icon can flip the moment the user clicks, without waiting
  // for an adb round-trip. `null` means "unknown" — the button renders
  // a neutral moon until the first getDarkMode call resolves.
  const connectedSerial = useDeviceStore((s) => s.current?.serial ?? null);
  const [darkMode, setDarkMode] = useState<boolean | null>(null);
  const [togglingDark, setTogglingDark] = useState(false);
  useEffect(() => {
    if (!connectedSerial || noDarkMode) {
      setDarkMode(null);
      return;
    }
    let cancelled = false;
    ipc
      .getDarkMode()
      .then((v) => {
        if (!cancelled) setDarkMode(v);
      })
      .catch(() => {
        // Older Android (< 10) / MIUI / etc. may not expose `cmd uimode`.
        // Swallow — the button still works, we just start from `off`.
        if (!cancelled) setDarkMode(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectedSerial, noDarkMode]);
  const toggleDarkMode = useCallback(async () => {
    if (togglingDark) return;
    const next = !(darkMode ?? false);
    setTogglingDark(true);
    // Optimistic flip — snap back on failure.
    setDarkMode(next);
    try {
      await ipc.setDarkMode(next);
    } catch (err) {
      setDarkMode(!next);
      toast.error("Dark mode toggle failed", err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingDark(false);
    }
  }, [darkMode, togglingDark]);

  // iOS-only Home button: presses the device Home button (XCTest
  // `/pressButton`) to return to the home screen. Mirrors where the
  // Android-only dark-mode toggle sits in the control cluster.
  const isIos = current?.platform === "ios";
  const [pressingHome, setPressingHome] = useState(false);
  const pressHome = useCallback(async () => {
    if (pressingHome) return;
    setPressingHome(true);
    try {
      await ipc.iosPressHome();
    } catch (err) {
      toast.error("Home button failed", err instanceof Error ? err.message : String(err));
    } finally {
      setPressingHome(false);
    }
  }, [pressingHome]);

  const [capturing, setCapturing] = useState(false);
  const takeScreenshot = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasFrame) return;
    const folder = useWorkspaceStore.getState().folderPath;
    if (!folder) {
      toast.error("No workspace open", "Open a folder first to save screenshots.");
      return;
    }
    setCapturing(true);
    try {
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) throw new Error("canvas returned no blob");
      const bytes = new Uint8Array(await blob.arrayBuffer());

      const dir = `${folder.replace(/\/$/, "")}/screenshots`;
      if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true });
      }

      const ts = formatTimestamp(new Date());
      let path = `${dir}/screenshot-${ts}.png`;
      let i = 2;
      while (await exists(path)) {
        path = `${dir}/screenshot-${ts}-${i}.png`;
        i += 1;
      }

      await writeFile(path, bytes);
      toast.success("Screenshot saved", path);
    } catch (err) {
      toast.error("Screenshot failed", err instanceof Error ? err.message : String(err));
    } finally {
      setCapturing(false);
    }
  }, [hasFrame]);

  useShortcuts(
    useMemo(
      () => [
        {
          key: "s",
          mod: true,
          shift: true,
          handler: () => void takeScreenshot(),
        },
      ],
      [takeScreenshot],
    ),
  );

  // Trackpad / mouse wheel → swipe gesture on the device. We batch
  // wheel events in a ~50 ms window (trackpads fire at ~60 Hz) and
  // emit one swipe per batch to avoid flooding the scrcpy control
  // channel and still feel smooth enough for native scroll lists.
  const wheelAccum = useRef(0);
  const wheelCursor = useRef<{ x: number; y: number } | null>(null);
  const wheelTimer = useRef<number | null>(null);
  const wheelFlush = useCallback(() => {
    wheelTimer.current = null;
    const delta = wheelAccum.current;
    const cursor = wheelCursor.current;
    wheelAccum.current = 0;
    // Drop tiny residual deltas — Android's scroll view treats a few
    // pixels as a tap-cancel rather than a fling.
    if (!cursor || Math.abs(delta) < 4 || scale === 0) return;

    // `delta` is in display-space pixels; convert to stream-space (which
    // is what scrcpy expects). `deviceDelta` ends up negative when the
    // user scrolls down — i.e. finger should move *up* on the device
    // to reveal content below. That matches Android's natural scroll.
    const deviceDelta = delta / scale;
    const y2 = Math.max(0, Math.min(deviceHeight - 1, cursor.y - Math.round(deviceDelta)));

    void ipc
      .sendInput(
        {
          kind: "swipe",
          x1: cursor.x,
          y1: cursor.y,
          x2: cursor.x,
          y2,
          // Short duration keeps consecutive swipes from overlapping
          // visibly — the scroll view sees a rapid sequence of short
          // gestures that it interprets roughly like a fling.
          duration_ms: 30,
        },
        deviceWidth,
        deviceHeight,
      )
      .catch(() => {
        // Silent: swipe failures during fast-scroll shouldn't spam
        // toasts. `sendInput` already surfaces real device-loss issues
        // via `deviceStore`.
      });
  }, [scale, deviceHeight, deviceWidth]);

  const onWheel = useCallback(
    (e: ReactWheelEvent) => {
      if (!current) return;
      const coords = toDeviceCoords(e.clientX, e.clientY);
      if (!coords) return;

      // Normalize so line/page scrolls (rare wheel mice) roughly match
      // pixel scrolls from a trackpad.
      const mult = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      wheelAccum.current += e.deltaY * mult;
      wheelCursor.current = coords;

      if (wheelTimer.current !== null) return;
      wheelTimer.current = window.setTimeout(wheelFlush, 50);
    },
    [current, toDeviceCoords, wheelFlush],
  );

  const overlayBounds: Bounds | null = hovered?.bounds ?? null;

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHovered(null)}
      onPointerDown={(e) => void onClick(e)}
      onContextMenu={(e) => void onContextMenu(e)}
      onWheel={onWheel}
    >
      {hasFrame ? null : <EmptyState connected={!!current} streamEnabled={streamEnabled} />}

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
            left: (canvasRect.width - displayW) / 2 + overlayBounds.left * overlayScaleX,
            top: (canvasRect.height - displayH) / 2 + overlayBounds.top * overlayScaleY,
            width: (overlayBounds.right - overlayBounds.left) * overlayScaleX,
            height: (overlayBounds.bottom - overlayBounds.top) * overlayScaleY,
          }}
        />
      ) : null}

      {hasFrame ? (
        <div className="absolute right-3 top-3 z-10 flex gap-2">
          {isIos ? (
            <button
              type="button"
              onClick={() => void pressHome()}
              disabled={pressingHome || !connectedSerial}
              title="Press Home (return to home screen)"
              aria-label="Press Home button"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-border/60 bg-background/70 text-foreground/80 shadow-sm backdrop-blur-sm transition hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <House className="h-4 w-4" />
            </button>
          ) : null}
          {!noDarkMode ? (
            <button
              type="button"
              onClick={() => void toggleDarkMode()}
              disabled={togglingDark || !connectedSerial}
              title={darkMode ? "Switch device to light mode" : "Switch device to dark mode"}
              aria-label="Toggle device dark mode"
              aria-pressed={darkMode ?? false}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-border/60 bg-background/70 text-foreground/80 shadow-sm backdrop-blur-sm transition hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {darkMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void takeScreenshot()}
            disabled={capturing}
            title="Screenshot · ⌘⇧S"
            aria-label="Take screenshot"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border/60 bg-background/70 text-foreground/80 shadow-sm backdrop-blur-sm transition hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Camera className="h-4 w-4" />
          </button>
        </div>
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

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

function EmptyState({ connected, streamEnabled }: { connected: boolean; streamEnabled: boolean }) {
  const lightweight = connected && !streamEnabled;
  return (
    <div className="pointer-events-none flex aspect-[9/19.5] max-h-full w-auto flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-background/60 p-6 text-center">
      <Smartphone className="h-10 w-10 text-muted-foreground/60" />
      <div className="text-sm font-medium">
        {lightweight
          ? "Lightweight mode"
          : connected
            ? "Waiting for frames…"
            : "No device connected"}
      </div>
      <div className="max-w-[16rem] text-xs text-muted-foreground">
        {lightweight
          ? "Live stream is off. Inspect and Run still work — taps from this view are disabled. Toggle in Settings to re-enable mirroring."
          : connected
            ? "The stream will appear here once scrcpy pushes the first frame."
            : "Plug in an Android device with USB debugging enabled, then pick it in the sidebar."}
      </div>
    </div>
  );
}
