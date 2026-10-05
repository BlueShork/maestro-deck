// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useCallback, useEffect, useMemo, useRef } from "react";

import { handleRpc, isRpcRequest } from "@/lib/plugins/bridge";
import { makeBridgeDeps } from "@/lib/plugins/hostDeps";
import { readThemeVars } from "@/lib/plugins/theme";
import type { PluginManifest } from "@/lib/plugins/types";
import { pluginUrl } from "@/lib/plugins/url";

/**
 * One plugin, isolated: `allow-scripts allow-forms` and NOT `allow-same-origin`
 * gives the frame an opaque origin — no Tauri IPC, no app storage, no parent
 * DOM. Its only channel is postMessage, and only messages whose source is this
 * frame's own window are answered.
 */
export function PluginHost({ manifest }: { manifest: PluginManifest }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const deps = useMemo(() => makeBridgeDeps(manifest), [manifest]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win || !isRpcRequest(e.data)) return;
      void handleRpc(e.data, deps).then((res) => win.postMessage(res, "*"));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [deps]);

  const sendTheme = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      { type: "md-event", name: "theme", data: readThemeVars() },
      "*",
    );
  }, []);

  useEffect(() => {
    const obs = new MutationObserver(sendTheme);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, [sendTheme]);

  return (
    <iframe
      ref={frame}
      title={manifest.name}
      src={pluginUrl(manifest.id, manifest.entry)}
      sandbox="allow-scripts allow-forms"
      onLoad={sendTheme}
      className="min-h-0 w-full flex-1 border-0 bg-background"
    />
  );
}
