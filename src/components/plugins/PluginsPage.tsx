// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { PixelChevron, PixelMosaic } from "@/components/brand/Pixel";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { buildCatalog } from "@/lib/plugins/registry";
import type { CatalogItem } from "@/lib/plugins/types";
import { pluginUrl } from "@/lib/plugins/url";
import { cn } from "@/lib/utils";
import { usePluginsStore } from "@/stores/pluginsStore";

/** Badge per status. Being listed already means available, so it gets none. */
const STATUS: Record<CatalogItem["status"], { label: string; className: string } | null> = {
  available: null,
  installed: { label: "Installed", className: "bg-brand text-brand-foreground" },
  update: { label: "Update", className: "border border-brand text-brand" },
  incompatible: { label: "Needs update", className: "border border-border text-muted-foreground" },
  broken: { label: "Broken", className: "bg-destructive text-destructive-foreground" },
};

/** The plugin marketplace: the curated registry as cards, installed plugins
 *  marked with the landing's warm bands. */
export function PluginsPage() {
  const { installed, registry, registryError, registryLoading } = usePluginsStore();
  const { refreshInstalled, refreshRegistry, loadDev } = usePluginsStore.getState();
  const items = useMemo(
    () => buildCatalog(registry, installed, __APP_VERSION__),
    [registry, installed],
  );
  const installedCount = items.filter((i) => i.installed).length;

  useEffect(() => {
    void refreshInstalled();
    void refreshRegistry();
  }, [refreshInstalled, refreshRegistry]);

  const pickDev = async () => {
    const dir = await open({ directory: true, title: "Select a plugin dist/ folder" });
    if (typeof dir === "string") await loadDev(dir);
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <PageHeader title="Plugins">
        <div className="ml-auto flex items-center gap-2 px-4">
          {import.meta.env.DEV ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void pickDev()}
              className="gap-1.5"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Load local plugin
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void refreshRegistry()}
            aria-label="Refresh marketplace"
            title="Refresh marketplace"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", registryLoading && "animate-spin")} />
          </Button>
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <PixelMosaic
          cols={40}
          rows={4}
          palette="orange"
          seed={7}
          className="h-[clamp(120px,12vw,190px)] w-full border-b border-border"
        >
          {/* Title tab sits on the banner's bottom edge, aligned with the cards. */}
          <div className="relative mx-auto flex h-full max-w-5xl items-end px-6">
            <h1 className="border border-b-0 border-border bg-background px-5 pb-3 pt-4 font-display text-[34px] font-medium leading-none tracking-[-0.045em] text-foreground">
              Marketplace
            </h1>
          </div>
        </PixelMosaic>

        <div className="mx-auto max-w-5xl px-6 py-8">
          <div className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
            <p className="max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              Connect Maestro Deck to the tools your team already uses. An installed plugin opens in
              the right-hand panel, next to your device.
            </p>
            <span className="mono-label">
              {installedCount} installed · {items.length} in the marketplace
            </span>
          </div>

          {registryError ? (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-5">
              <div className="flex flex-col">
                <span className="text-sm">Couldn't reach the marketplace</span>
                <span className="text-xs text-muted-foreground">
                  {registryError}. Installed plugins keep working.
                </span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void refreshRegistry()}
                className="gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          ) : null}

          {items.length === 0 ? (
            <p className="mono-label">
              {registryLoading
                ? "Loading the marketplace…"
                : registryError
                  ? ""
                  : "No plugins yet."}
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <PluginCard key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function PluginCard({ item }: { item: CatalogItem }) {
  const navigate = useNavigate();
  const working = usePluginsStore((s) => s.busy[item.id] ?? false);
  const { install, uninstall, openPluginPanel, revokeOrigin } = usePluginsStore.getState();
  const manifest = item.installed?.manifest;
  const status = STATUS[item.status];
  const version = item.installed?.version ?? item.registry?.version;
  const description =
    item.status === "incompatible"
      ? `Requires Maestro Deck ${item.registry?.minAppVersion} or later.`
      : item.status === "broken"
        ? (item.installed?.error ?? "")
        : item.description;

  return (
    <li
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-border bg-background",
        item.installed && !item.installed.error && "warm-bands",
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border bg-surface px-5 pb-4 pt-6">
        <div
          aria-hidden
          className="flex h-12 w-12 shrink-0 select-none items-center justify-center border border-border bg-background font-display text-2xl font-medium tracking-[-0.04em]"
        >
          {manifest?.icon ? (
            <img src={pluginUrl(item.id, manifest.icon)} alt="" className="h-7 w-7" />
          ) : (
            item.name.trim()[0]?.toUpperCase()
          )}
        </div>
        {status ? (
          <span className={cn("px-2 py-0.5 font-mono text-[10px] uppercase", status.className)}>
            {status.label}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col px-5 py-4">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-display text-xl font-medium tracking-[-0.03em]">
            {item.name}
          </span>
          {version ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              v{version}
              {item.installed?.dev ? " · dev" : ""}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        {item.installed?.grantedOrigins?.length ? (
          <ul className="mt-3 flex flex-col gap-1">
            {item.installed.grantedOrigins.map((o) => (
              <li key={o} className="flex items-center justify-between gap-2 font-mono text-[11px]">
                <span className="truncate text-muted-foreground" title={o}>
                  {new URL(o).host}
                </span>
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => void revokeOrigin(item.id, o)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {item.registry?.repo ? (
          <span className="mono-label mt-auto truncate pt-4">{item.registry.repo}</span>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-5 py-3">
        {(item.status === "available" || item.status === "update") && item.registry ? (
          <Button
            size="sm"
            disabled={working}
            onClick={() => void install(item.registry!)}
            className="group gap-2"
          >
            {item.status === "update" ? `Update to v${item.registry.version}` : "Install"}
            <PixelChevron className="transition-transform duration-150 [transition-timing-function:steps(2,end)] group-hover:translate-x-[3px]" />
          </Button>
        ) : null}
        {item.status === "installed" && manifest?.panel ? (
          <Button
            size="sm"
            onClick={() => {
              openPluginPanel(item.id);
              navigate("/");
            }}
          >
            Open
          </Button>
        ) : null}
        {working ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        {item.installed ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={working}
            onClick={() => void uninstall(item.id)}
            className="ml-auto text-muted-foreground"
          >
            Uninstall
          </Button>
        ) : null}
      </div>
    </li>
  );
}
