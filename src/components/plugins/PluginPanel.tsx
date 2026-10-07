// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { X } from "lucide-react";

import { PanelAction, PanelHeader } from "@/components/PanelHeader";
import { PluginHost } from "@/components/plugins/PluginHost";
import { usePluginsStore } from "@/stores/pluginsStore";

/** The open plugin in the right-hand slot. Keyed on id@version so an update
 *  reloads the frame with the new files. */
export function PluginPanel() {
  const openPanel = usePluginsStore((s) => s.openPanel);
  const plugin = usePluginsStore((s) => s.installed.find((p) => p.id === s.openPanel));
  const close = usePluginsStore((s) => s.closePluginPanel);
  const manifest = plugin?.manifest;
  if (!openPanel) return null;

  return (
    <div className="flex h-full flex-col bg-background">
      <PanelHeader title={manifest?.panel?.title ?? manifest?.name ?? openPanel}>
        <PanelAction onClick={close} aria-label="Close plugin panel" title="Close">
          <X className="h-3.5 w-3.5" />
        </PanelAction>
      </PanelHeader>
      {manifest ? (
        <PluginHost key={`${manifest.id}@${plugin.version}`} manifest={manifest} />
      ) : (
        <p className="p-4 text-xs text-muted-foreground">
          {plugin?.error ?? "This plugin is not installed."}
        </p>
      )}
    </div>
  );
}
