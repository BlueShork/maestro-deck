// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { FolderOpen, ImageIcon, RefreshCw, Search, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DeviceArt } from "@/components/devices/DeviceArt";
import { PageHeader } from "@/components/PageHeader";
import { PixelChevron } from "@/components/brand/Pixel";
import { Button } from "@/components/ui/Button";
import { filterGroups, filterImages } from "@/lib/bankFilter";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { BankGroup, BankImage } from "@/types/visualRegression";

// device_key is `<sanitized_model>_<w>x<h>` (e.g. "iPhone_16_Pro_1179x2556").
// Split it back into something humans read.
type DeviceKind = "ios" | "android" | "web";

function parseDeviceKey(key: string): { name: string; resolution: string; kind: DeviceKind } {
  const m = key.match(/^(.*)_(\d+)x(\d+)$/);
  const name = (m ? m[1] : key).replace(/_+/g, " ").trim();
  // Older iOS banks were keyed `_0x0` (device reported no resolution) — don't
  // surface a meaningless "0×0".
  const resolution = m && !(m[2] === "0" && m[3] === "0") ? `${m[2]}×${m[3]}` : "";
  // The web target's model is "Web Browser (Chromium)".
  const kind: DeviceKind = /web browser|chromium/i.test(name)
    ? "web"
    : /iphone|ipad|ipod|ios/i.test(name)
      ? "ios"
      : "android";
  return { name, resolution, kind };
}

/** The bank's device drawn like the device picker draws it. Bank keys don't
 *  say whether a capture came from a simulator, so every handset is a phone. */
function BankDeviceArt({
  meta,
  seedKey,
  className,
}: {
  meta: { name: string; kind: DeviceKind };
  seedKey: string;
  className?: string;
}) {
  return (
    <DeviceArt
      platform={meta.kind}
      kind={meta.kind === "web" ? "web" : "physical"}
      source="local"
      tablet={/\b(ipad|tablet|tab)\b/i.test(meta.name)}
      seedKey={seedKey}
      className={className}
    />
  );
}

function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Lazy-loaded thumbnail rendered as a framed device screen. */
function Thumb({
  workspace,
  deviceKey,
  image,
  index,
  aspect,
  onOpen,
  onDelete,
}: {
  workspace: string;
  deviceKey: string;
  image: BankImage;
  index: number;
  /** Width / height of the screen mat, shared by the whole device group. */
  aspect: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    void ipc
      .loadBankImage(workspace, deviceKey, image.name)
      .then((s) => {
        if (alive) setSrc(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workspace, deviceKey, image.name]);

  return (
    <div
      className="group animate-in fade-in-0 fill-mode-both relative flex flex-col overflow-hidden border-b border-r border-border bg-background transition-colors duration-150 hover:bg-accent"
      style={{ animationDelay: `${Math.min(index, 14) * 35}ms` }}
    >
      {/* Screen mat */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${image.name}`}
        style={{ aspectRatio: aspect }}
        className="relative flex items-center justify-center overflow-hidden bg-surface p-3 transition-colors group-hover:bg-transparent"
      >
        {src ? (
          <img
            src={src}
            alt={image.name}
            className="max-h-full max-w-full rounded-sm object-contain shadow-[0_12px_24px_-12px_rgba(0,0,0,0.5)]"
          />
        ) : (
          <div className="h-full w-full animate-pulse bg-muted" />
        )}
      </button>

      {/* Delete affordance — appears on hover, top-right. A sibling of the
          open-button rather than a child: a button inside a button is invalid
          HTML, which is what forced the previous `role="button"` span (and
          left it unreachable by keyboard). */}
      <button
        type="button"
        aria-label={confirming ? `Confirm delete ${image.name}` : `Delete ${image.name}`}
        onClick={() => {
          if (confirming) onDelete();
          else {
            setConfirming(true);
            window.setTimeout(() => setConfirming(false), 3000);
          }
        }}
        className={cn(
          "absolute right-2 top-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[10px] uppercase transition-all focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          confirming
            ? "bg-destructive text-destructive-foreground opacity-100"
            : "border border-border bg-background text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100",
        )}
      >
        {confirming ? "Delete?" : <Trash2 className="h-3.5 w-3.5" />}
      </button>

      {/* Caption */}
      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <span className="truncate font-mono text-[11px]">{image.name}</span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {image.width}×{image.height}
        </span>
      </div>
    </div>
  );
}

function Lightbox({
  workspace,
  deviceKey,
  images,
  index,
  onIndex,
  onClose,
}: {
  workspace: string;
  deviceKey: string;
  images: BankImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const image = images[index];

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setZoomed(false);
    void ipc
      .loadBankImage(workspace, deviceKey, image.name)
      .then((s) => {
        if (alive) setSrc(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workspace, deviceKey, image.name]);

  const prev = useCallback(
    () => onIndex((index - 1 + images.length) % images.length),
    [index, images.length, onIndex],
  );
  const next = useCallback(
    () => onIndex((index + 1) % images.length),
    [index, images.length, onIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key.toLowerCase() === "z") setZoomed((z) => !z);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next]);

  return (
    <div className="animate-in fade-in-0 fixed inset-0 z-50 flex flex-col bg-[#101013] duration-200">
      {/* Top metadata bar */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-4 py-2.5 text-white">
        <div className="min-w-0">
          <div className="truncate font-display text-lg font-medium tracking-[-0.02em]">
            {image.name}
          </div>
          <div className="truncate font-mono text-[11px] text-white/50">
            {image.width}×{image.height} · {formatBytes(image.size_bytes)} ·{" "}
            {formatDate(image.modified_ms)}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoomed((z) => !z)}
            aria-label={zoomed ? "Fit to screen" : "Actual size"}
            className="rounded-md p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            {zoomed ? <ZoomOut className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview (Esc)"
            className="rounded-md p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Stage */}
      <div
        className={cn(
          "relative flex min-h-0 flex-1 items-center justify-center p-6",
          zoomed && "overflow-auto",
        )}
        onClick={onClose}
      >
        {images.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            aria-label="Previous"
            className="absolute left-3 z-10 rounded-md bg-white/10 p-2 text-white/80 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <PixelChevron direction="left" size={16} />
          </button>
        )}

        {src ? (
          <img
            src={src}
            alt={image.name}
            onClick={(e) => {
              e.stopPropagation();
              setZoomed((z) => !z);
            }}
            className={cn(
              "animate-in fade-in-0 zoom-in-95 rounded-lg shadow-2xl ring-1 ring-white/10 duration-200",
              zoomed
                ? "max-w-none cursor-zoom-out"
                : "max-h-[80vh] max-w-[86vw] cursor-zoom-in object-contain",
            )}
          />
        ) : (
          <div className="h-64 w-40 animate-pulse rounded-lg bg-white/10" />
        )}

        {images.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            aria-label="Next"
            className="absolute right-3 z-10 rounded-md bg-white/10 p-2 text-white/80 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <PixelChevron size={16} />
          </button>
        )}
      </div>

      {/* Footer hint */}
      <div className="flex shrink-0 items-center justify-center gap-3 border-t border-white/10 px-4 py-2 font-mono text-[10px] text-white/40">
        <span>
          {index + 1} / {images.length}
        </span>
        <span className="text-white/20">·</span>
        <span>← → navigate</span>
        <span className="text-white/20">·</span>
        <span>Z zoom</span>
        <span className="text-white/20">·</span>
        <span>Esc close</span>
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="animate-in fade-in-0 zoom-in-95 flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center duration-300">
      <div className="flex h-16 w-16 items-center justify-center bg-brand text-brand-foreground">
        {icon}
      </div>
      <div className="max-w-sm space-y-1.5">
        <div className="font-display text-xl font-medium tracking-[-0.03em]">{title}</div>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function ThumbSkeleton({ index }: { index: number }) {
  return (
    <div
      className="animate-in fade-in-0 fill-mode-both overflow-hidden border-b border-r border-border bg-background"
      style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
    >
      <div className="aspect-[3/4] animate-pulse bg-surface" />
      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <div className="h-2.5 w-16 animate-pulse rounded bg-muted/60" />
        <div className="h-2.5 w-10 animate-pulse rounded bg-muted/40" />
      </div>
    </div>
  );
}

export function ImageBankPage() {
  const navigate = useNavigate();
  const folderPath = useWorkspaceStore((s) => s.folderPath);
  const [groups, setGroups] = useState<BankGroup[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [confirmGroup, setConfirmGroup] = useState(false);
  const [query, setQuery] = useState("");
  const mountedRef = useRef(true);
  const galleryScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Reset on (re)mount too — React 18 StrictMode mounts, unmounts, then
    // remounts in dev; without re-setting this to true the guard would stay
    // false after the remount and every setState would be skipped.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!folderPath) {
      if (mountedRef.current) {
        setGroups([]);
        setSelected(null);
        setLoading(false);
      }
      return;
    }
    if (mountedRef.current) setLoading(true);
    try {
      const g = await ipc.listBank(folderPath);
      if (!mountedRef.current) return;
      setGroups(g);
      setSelected((prev) =>
        prev && g.some((x) => x.device_key === prev) ? prev : (g[0]?.device_key ?? null),
      );
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [folderPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lightboxIndex !== null) setLightboxIndex(null);
      else if (query) setQuery("");
      else navigate("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, lightboxIndex, query]);

  const activeGroup = groups.find((g) => g.device_key === selected) ?? null;
  const totalImages = groups.reduce((n, g) => n + g.images.length, 0);
  const activeMeta = activeGroup ? parseDeviceKey(activeGroup.device_key) : null;
  const activeSize = activeGroup?.images.reduce((n, i) => n + i.size_bytes, 0) ?? 0;
  // Size the mats to the group's typical screenshot shape (median, so one odd
  // capture doesn't reshape the grid) instead of a fixed 3:4 box that leaves
  // landscape web captures floating in empty space.
  const groupAspect = useMemo(() => {
    const ratios = (activeGroup?.images ?? [])
      .filter((i) => i.width > 0 && i.height > 0)
      .map((i) => i.width / i.height)
      .sort((a, b) => a - b);
    return ratios.length ? ratios[Math.floor(ratios.length / 2)] : 3 / 4;
  }, [activeGroup]);

  const visibleGroups = filterGroups(groups, query);
  const visibleImages = activeGroup ? filterImages(activeGroup.images, query) : [];
  const filtering = query.trim().length > 0;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <PageHeader title="Image Bank">
        <div className="flex min-w-0 flex-1 items-center px-4 font-mono text-[11px] uppercase text-muted-foreground">
          <span className="truncate">
            {folderPath
              ? `${groups.length} device${groups.length === 1 ? "" : "s"} · ${totalImages} baseline${totalImages === 1 ? "" : "s"}`
              : "no workspace"}
          </span>
        </div>
        {folderPath && groups.length > 0 && (
          <label className="flex w-72 items-center gap-2 border-l border-border px-4 text-muted-foreground focus-within:text-foreground">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search screenshots…"
              aria-label="Search screenshots by name"
              className="h-full w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
            {filtering && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </label>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || !folderPath}
          aria-label="Refresh"
          title="Refresh"
          className="flex w-12 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </PageHeader>

      {!folderPath ? (
        <EmptyState icon={<FolderOpen className="h-7 w-7" />} title="No workspace open">
          Open a folder in the workspace to browse its screenshot baselines.
        </EmptyState>
      ) : loading && groups.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
            {Array.from({ length: 8 }).map((_, i) => (
              <ThumbSkeleton key={i} index={i} />
            ))}
          </div>
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={<ImageIcon className="h-7 w-7" />} title="No baselines yet">
          Run a flow with a{" "}
          <code className="bg-surface px-1.5 py-0.5 font-mono text-xs text-foreground">
            takeScreenshot
          </code>{" "}
          command to seed the bank. Captures are compared against these on every run.
        </EmptyState>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Device sidebar */}
          <nav className="w-64 shrink-0 overflow-y-auto border-r border-border py-2.5">
            <div className="mono-label px-4 pb-1.5 pt-1 text-[10px]">Devices</div>
            {visibleGroups.map((g) => {
              const meta = parseDeviceKey(g.device_key);
              const active = selected === g.device_key;
              return (
                <button
                  key={g.device_key}
                  type="button"
                  onClick={() => {
                    setSelected(g.device_key);
                    setConfirmGroup(false);
                  }}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex w-full items-center gap-2.5 overflow-hidden px-4 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                    active ? "bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-brand" />}
                  <BankDeviceArt
                    meta={meta}
                    seedKey={g.device_key}
                    className="h-9 w-auto shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{meta.name}</span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      {meta.resolution}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                      active
                        ? "bg-brand text-brand-foreground"
                        : "bg-surface text-muted-foreground",
                    )}
                  >
                    {filtering ? filterImages(g.images, query).length : g.images.length}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Gallery */}
          <div ref={galleryScrollRef} className="min-h-0 flex-1 overflow-y-auto">
            {activeGroup && activeMeta ? (
              <div>
                {/* Landing page hero: the device, its name in Inter Tight, a
                    Space Mono meta line, the destructive action on the right. */}
                <div className="flex items-end justify-between gap-3 border-b border-border px-6 pb-5 pt-6">
                  <div className="flex items-end gap-4">
                    <BankDeviceArt
                      meta={activeMeta}
                      seedKey={activeGroup.device_key}
                      className="h-20 w-auto shrink-0"
                    />
                    <div className="flex flex-col gap-2 pb-0.5">
                      <span className="mono-label">Baselines</span>
                      <h1 className="font-display text-[34px] font-medium leading-none tracking-[-0.045em]">
                        {activeMeta.name}
                      </h1>
                      <div className="font-mono text-[11px] uppercase text-muted-foreground">
                        {activeMeta.resolution} ·{" "}
                        {filtering
                          ? `${visibleImages.length} / ${activeGroup.images.length} baseline`
                          : `${activeGroup.images.length} baseline`}
                        {activeGroup.images.length === 1 ? "" : "s"} · {formatBytes(activeSize)}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={confirmGroup ? "destructive" : "secondary"}
                    onClick={() => {
                      if (confirmGroup) {
                        void ipc
                          .deleteBankDevice(folderPath, activeGroup.device_key)
                          .then(refresh)
                          .finally(() => setConfirmGroup(false));
                      } else {
                        setConfirmGroup(true);
                        window.setTimeout(() => setConfirmGroup(false), 3000);
                      }
                    }}
                    className={cn("mb-0.5", !confirmGroup && "text-muted-foreground")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {confirmGroup ? "Confirm delete device?" : "Delete device"}
                  </Button>
                </div>

                {filtering && visibleImages.length === 0 ? (
                  <EmptyState icon={<Search className="h-7 w-7" />} title="No results">
                    No screenshot matches "{query.trim()}" in this device group.
                  </EmptyState>
                ) : (
                  // Landing tiles: cells sharing hairlines, no gaps.
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: `repeat(auto-fill, minmax(${groupAspect < 1 ? 170 : 300}px, 1fr))`,
                    }}
                  >
                    {visibleImages.map((img) => (
                      <Thumb
                        key={img.name}
                        workspace={folderPath}
                        deviceKey={activeGroup.device_key}
                        image={img}
                        index={activeGroup.images.indexOf(img)}
                        aspect={groupAspect}
                        onOpen={() => setLightboxIndex(activeGroup.images.indexOf(img))}
                        onDelete={() =>
                          void ipc
                            .deleteBankImage(folderPath, activeGroup.device_key, img.name)
                            .then(refresh)
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {activeGroup && lightboxIndex !== null && activeGroup.images[lightboxIndex] ? (
        <Lightbox
          workspace={folderPath!}
          deviceKey={activeGroup.device_key}
          images={activeGroup.images}
          index={lightboxIndex}
          onIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </div>
  );
}
