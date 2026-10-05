// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { ipc } from "@/lib/ipc";
import type { BridgeDeps } from "@/lib/plugins/bridge";
import type { PluginManifest } from "@/lib/plugins/types";
import { toast } from "@/stores/toastStore";

function platform(): string {
  const ua = navigator.userAgent;
  return /Windows/.test(ua) ? "windows" : /Macintosh|Mac OS X/.test(ua) ? "macos" : "linux";
}

/** Wires the pure RPC bridge to IPC and the toast store for one plugin. */
export function makeBridgeDeps(manifest: PluginManifest): BridgeDeps {
  const id = manifest.id;
  const open = (url: string) => ipc.pluginOpenExternal(id, url);
  return {
    manifest,
    secretGet: (key) => ipc.pluginSecretGet(id, key),
    secretSet: (key, value) => ipc.pluginSecretSet(id, key, value),
    secretDelete: (key) => ipc.pluginSecretDelete(id, key),
    httpFetch: (req) => ipc.pluginHttpFetch(id, req),
    openExternal: open,
    toast: ({ kind, message, action }) => {
      const act = action
        ? {
            label: action.label,
            onClick: () => {
              open(action.url).catch((err) => toast.error("Could not open the link", String(err)));
            },
          }
        : undefined;
      const show = kind === "success" ? toast.success : kind === "error" ? toast.error : toast.info;
      show(message, undefined, act);
    },
    appInfo: () => ({ appVersion: __APP_VERSION__, platform: platform() }),
    storage: localStorage,
  };
}
