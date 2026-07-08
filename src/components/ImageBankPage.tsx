// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { ArrowLeft, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { BankGroup, BankImage } from "@/types/visualRegression";

/** Lazy-loaded thumbnail: fetches its own base64 so the listing stays cheap. */
function Thumb({
  workspace,
  deviceKey,
  image,
  onOpen,
  onDelete,
}: {
  workspace: string;
  deviceKey: string;
  image: BankImage;
  onOpen: (src: string) => void;
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
    <div className="group relative flex flex-col gap-1 rounded-lg border border-border p-2">
      <button
        type="button"
        onClick={() => src && onOpen(src)}
        className="flex aspect-[9/16] items-center justify-center overflow-hidden rounded bg-muted/40"
        aria-label={`Open ${image.name}`}
      >
        {src ? (
          <img src={src} alt={image.name} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[10px] text-muted-foreground">loading…</span>
        )}
      </button>
      <div className="flex items-center justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{image.name}</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {image.width}×{image.height}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirming) onDelete();
            else {
              setConfirming(true);
              window.setTimeout(() => setConfirming(false), 3000);
            }
          }}
          className={cn(
            "shrink-0 rounded px-1.5 py-1 text-[10px] transition-colors",
            confirming
              ? "bg-red-500/15 text-red-600 dark:text-red-400"
              : "text-muted-foreground hover:bg-accent",
          )}
          aria-label={confirming ? `Confirm delete ${image.name}` : `Delete ${image.name}`}
        >
          {confirming ? "Confirm?" : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

export function ImageBankPage() {
  const navigate = useNavigate();
  const folderPath = useWorkspaceStore((s) => s.folderPath);
  const [groups, setGroups] = useState<BankGroup[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [confirmGroup, setConfirmGroup] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    // Reset on (re)mount too — React 18 StrictMode mounts, unmounts, then
    // remounts in dev; without re-setting this to true the guard would stay
    // false after the remount and every setState (incl. setLoading(false))
    // would be skipped, leaving the page stuck on "Loading…".
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!folderPath) {
      if (mountedRef.current) setGroups([]);
      if (mountedRef.current) setSelected(null);
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
      if (lightbox) setLightbox(null);
      else navigate("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, lightbox]);

  const activeGroup = groups.find((g) => g.device_key === selected) ?? null;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => navigate("/")}
          aria-label="Back to workspace"
          title="Back to workspace (Esc)"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-semibold">Image Bank</span>
      </header>

      {!folderPath ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          Open a folder to use the image bank.
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          {loading
            ? "Loading…"
            : "No baselines yet. Run a flow with takeScreenshot to seed the bank."}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav className="w-56 shrink-0 overflow-y-auto border-r border-border p-2">
            {groups.map((g) => (
              <button
                key={g.device_key}
                type="button"
                onClick={() => {
                  setSelected(g.device_key);
                  setConfirmGroup(false);
                }}
                aria-current={selected === g.device_key ? "page" : undefined}
                className={cn(
                  "w-full rounded px-3 py-1.5 text-left text-xs transition-colors",
                  selected === g.device_key
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <div className="truncate font-mono">{g.device_key}</div>
                <div className="text-[10px] text-muted-foreground">{g.images.length} image(s)</div>
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {activeGroup ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-mono text-xs text-muted-foreground">
                    {activeGroup.device_key}
                  </div>
                  <Button
                    size="xs"
                    variant={confirmGroup ? "destructive" : "outline"}
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
                  >
                    {confirmGroup ? "Confirm delete group?" : "Delete group"}
                  </Button>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                  {activeGroup.images.map((img) => (
                    <Thumb
                      key={img.name}
                      workspace={folderPath}
                      deviceKey={activeGroup.device_key}
                      image={img}
                      onOpen={setLightbox}
                      onDelete={() =>
                        void ipc
                          .deleteBankImage(folderPath, activeGroup.device_key, img.name)
                          .then(refresh)
                      }
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {lightbox ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="preview"
            className="max-h-[92vh] max-w-[92vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}
