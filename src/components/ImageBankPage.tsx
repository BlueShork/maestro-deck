// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  ImageIcon,
  Layers,
  RefreshCw,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AndroidLogo, AppleLogo } from "@/components/BrandIcons";
import { Button } from "@/components/ui/Button";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { BankGroup, BankImage } from "@/types/visualRegression";

// device_key is `<sanitized_model>_<w>x<h>` (e.g. "iPhone_16_Pro_1179x2556").
// Split it back into something humans read.
function parseDeviceKey(key: string): { name: string; resolution: string; ios: boolean } {
  const m = key.match(/^(.*)_(\d+)x(\d+)$/);
  const name = (m ? m[1] : key).replace(/_/g, " ").trim();
  const resolution = m ? `${m[2]}×${m[3]}` : "";
  const ios = /iphone|ipad|ipod|ios/i.test(name);
  return { name, resolution, ios };
}

function DeviceGlyph({ ios, className }: { ios: boolean; className?: string }) {
  return ios ? <AppleLogo className={className} /> : <AndroidLogo className={className} />;
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
  onOpen,
  onDelete,
}: {
  workspace: string;
  deviceKey: string;
  image: BankImage;
  index: number;
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
      className="group animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-both flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5"
      style={{ animationDelay: `${Math.min(index, 14) * 35}ms` }}
    >
      {/* Screen mat */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${image.name}`}
        className="relative flex aspect-[3/4] items-center justify-center overflow-hidden bg-[radial-gradient(120%_120%_at_50%_0%,hsl(var(--muted))_0%,hsl(var(--background))_100%)] p-3"
      >
        {src ? (
          <img
            src={src}
            alt={image.name}
            className="max-h-full max-w-full rounded-md object-contain shadow-md ring-1 ring-black/10 transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="h-full w-full animate-pulse rounded-md bg-muted/60" />
        )}

        {/* Delete affordance — appears on hover, top-right */}
        <span
          role="button"
          tabIndex={0}
          aria-label={confirming ? `Confirm delete ${image.name}` : `Delete ${image.name}`}
          onClick={(e) => {
            e.stopPropagation();
            if (confirming) onDelete();
            else {
              setConfirming(true);
              window.setTimeout(() => setConfirming(false), 3000);
            }
          }}
          className={cn(
            "absolute right-2 top-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium backdrop-blur transition-all",
            confirming
              ? "bg-red-500/90 text-white opacity-100"
              : "bg-background/70 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100",
          )}
        >
          {confirming ? "Delete?" : <Trash2 className="h-3.5 w-3.5" />}
        </span>
      </button>

      {/* Caption */}
      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <span className="truncate text-xs font-medium">{image.name}</span>
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
    <div className="animate-in fade-in-0 fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-md duration-200">
      {/* Top metadata bar */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-4 py-2.5 text-white">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{image.name}</div>
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
            className="rounded-md p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            {zoomed ? <ZoomOut className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview (Esc)"
            className="rounded-md p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
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
            className="absolute left-3 z-10 rounded-full bg-white/10 p-2 text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
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
            className="absolute right-3 z-10 rounded-full bg-white/10 p-2 text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
          >
            <ChevronRight className="h-5 w-5" />
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
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-muted/40 text-muted-foreground">
        {icon}
      </div>
      <div className="max-w-sm space-y-1.5">
        <div className="text-base font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function ThumbSkeleton({ index }: { index: number }) {
  return (
    <div
      className="animate-in fade-in-0 fill-mode-both overflow-hidden rounded-xl border border-border bg-card"
      style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
    >
      <div className="aspect-[3/4] animate-pulse bg-muted/50" />
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
  const mountedRef = useRef(true);

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
      else navigate("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, lightboxIndex]);

  const activeGroup = groups.find((g) => g.device_key === selected) ?? null;
  const totalImages = groups.reduce((n, g) => n + g.images.length, 0);
  const activeMeta = activeGroup ? parseDeviceKey(activeGroup.device_key) : null;
  const activeSize = activeGroup?.images.reduce((n, i) => n + i.size_bytes, 0) ?? 0;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-gradient-to-b from-muted/40 to-background px-3">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => navigate("/")}
          aria-label="Back to workspace"
          title="Back to workspace (Esc)"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
          <Layers className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight">Image Bank</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {folderPath
              ? `${groups.length} device${groups.length === 1 ? "" : "s"} · ${totalImages} baseline${totalImages === 1 ? "" : "s"}`
              : "no workspace"}
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => void refresh()}
          disabled={loading || !folderPath}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </header>

      {!folderPath ? (
        <EmptyState icon={<FolderOpen className="h-7 w-7" />} title="No workspace open">
          Open a folder in the workspace to browse its screenshot baselines.
        </EmptyState>
      ) : loading && groups.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <ThumbSkeleton key={i} index={i} />
            ))}
          </div>
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={<ImageIcon className="h-7 w-7" />} title="No baselines yet">
          Run a flow with a{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
            takeScreenshot
          </code>{" "}
          command to seed the bank. Captures are compared against these on every run.
        </EmptyState>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Device sidebar */}
          <nav className="w-64 shrink-0 space-y-1 overflow-y-auto border-r border-border p-2.5">
            <div className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Devices
            </div>
            {groups.map((g) => {
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
                    "group relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-2 text-left transition-colors",
                    active ? "bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  {active && (
                    <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-emerald-500" />
                  )}
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <DeviceGlyph ios={meta.ios} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{meta.name}</span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      {meta.resolution}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                      active
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {g.images.length}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Gallery */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeGroup && activeMeta ? (
              <div className="p-5">
                <div className="mb-4 flex items-end justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-muted/50 text-foreground">
                      <DeviceGlyph ios={activeMeta.ios} className="h-5 w-5" />
                    </span>
                    <div>
                      <h1 className="text-lg font-semibold leading-tight">{activeMeta.name}</h1>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {activeMeta.resolution} · {activeGroup.images.length} baseline
                        {activeGroup.images.length === 1 ? "" : "s"} · {formatBytes(activeSize)}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={confirmGroup ? "destructive" : "ghost"}
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
                    className={cn(!confirmGroup && "text-muted-foreground")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {confirmGroup ? "Confirm delete device?" : "Delete device"}
                  </Button>
                </div>

                <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-4">
                  {activeGroup.images.map((img, i) => (
                    <Thumb
                      key={img.name}
                      workspace={folderPath}
                      deviceKey={activeGroup.device_key}
                      image={img}
                      index={i}
                      onOpen={() => setLightboxIndex(i)}
                      onDelete={() =>
                        void ipc
                          .deleteBankImage(folderPath, activeGroup.device_key, img.name)
                          .then(refresh)
                      }
                    />
                  ))}
                </div>
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
