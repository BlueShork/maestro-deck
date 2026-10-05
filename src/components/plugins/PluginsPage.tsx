// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { open } from "@tauri-apps/plugin-dialog";
import { Loader2, Puzzle, RefreshCw } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { buildCatalog } from "@/lib/plugins/registry";
import type { CatalogItem } from "@/lib/plugins/types";
import { pluginUrl } from "@/lib/plugins/url";
import { usePluginsStore } from "@/stores/pluginsStore";

const STATUS_LABEL: Record<CatalogItem["status"], string> = {
  available: "Available",
  installed: "Installed",
  update: "Update available",
  incompatible: "Needs a newer Maestro Deck",
  broken: "Broken",
};

export function PluginsPage() {
  const navigate = useNavigate();
  const { installed, registry, registryError, registryLoading, busy } = usePluginsStore();
  const { refreshInstalled, refreshRegistry, install, uninstall, loadDev, openPluginPanel } =
    usePluginsStore.getState();
  const items = useMemo(
    () => buildCatalog(registry, installed, __APP_VERSION__),
    [registry, installed],
  );

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
            <Button variant="outline" size="sm" onClick={() => void pickDev()}>
              Load local plugin
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refreshRegistry()}
            aria-label="Refresh catalogue"
          >
            <RefreshCw className={registryLoading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          </Button>
        </div>
      </PageHeader>
      <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-6">
        {registryError ? (
          <div className="mb-4 border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Could not load the plugin catalogue: {registryError}
          </div>
        ) : null}
        {items.length === 0 && !registryLoading ? (
          <p className="text-sm text-muted-foreground">No plugins available yet.</p>
        ) : null}
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const m = item.installed?.manifest;
            const working = busy[item.id];
            return (
              <li key={item.id} className="flex items-start gap-4 border border-border p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-border">
                  {m?.icon ? (
                    <img src={pluginUrl(item.id, m.icon)} alt="" className="h-6 w-6" />
                  ) : (
                    <Puzzle className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{item.name}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {item.installed ? `v${item.installed.version}` : `v${item.registry?.version}`}
                      {item.installed?.dev ? " · dev" : ""}
                    </span>
                    <span className="mono-label text-[10px] text-muted-foreground">
                      {STATUS_LABEL[item.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.status === "incompatible"
                      ? `Requires Maestro Deck ${item.registry?.minAppVersion} or later.`
                      : item.status === "broken"
                        ? item.installed?.error
                        : item.description}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {working ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {item.status === "available" && item.registry ? (
                    <Button
                      size="sm"
                      disabled={working}
                      onClick={() => void install(item.registry!)}
                    >
                      Install
                    </Button>
                  ) : null}
                  {item.status === "update" && item.registry ? (
                    <Button
                      size="sm"
                      disabled={working}
                      onClick={() => void install(item.registry!)}
                    >
                      Update to v{item.registry.version}
                    </Button>
                  ) : null}
                  {item.status === "installed" && m?.panel ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        openPluginPanel(item.id);
                        navigate("/");
                      }}
                    >
                      Open
                    </Button>
                  ) : null}
                  {item.installed ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={working}
                      onClick={() => void uninstall(item.id)}
                    >
                      Uninstall
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
