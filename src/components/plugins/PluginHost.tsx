// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { handleRpc, isRpcRequest } from "@/lib/plugins/bridge";
import { makeBridgeDeps } from "@/lib/plugins/hostDeps";
import { readThemeVars } from "@/lib/plugins/theme";
import type { PluginManifest } from "@/lib/plugins/types";
import { pluginUrl } from "@/lib/plugins/url";
import { useRunReportStore } from "@/stores/runReportStore";
import { useOriginGrantStore } from "@/stores/originGrantStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * One plugin, isolated: `allow-scripts allow-forms` and NOT `allow-same-origin`
 * gives the frame an opaque origin — no app storage, no parent DOM. Its only
 * channel is postMessage, and only messages whose source is this frame's own
 * window are answered.
 *
 * A frame's window survives navigation and every sandboxed document has the
 * same "null" origin, so a remote page the frame navigated to would pass the
 * source check with the plugin's rights. The plugin's own document is the
 * first load; any later load stops the plugin.
 */
export function PluginHost({ manifest }: { manifest: PluginManifest }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loads = useRef(0);
  const [stopped, setStopped] = useState(false);
  const deps = useMemo(() => makeBridgeDeps(manifest), [manifest]);

  // A refusal holds until the panel is reopened.
  useEffect(() => useOriginGrantStore.getState().forgetRefusal(manifest.id), [manifest.id]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win || loads.current > 1 || !isRpcRequest(e.data)) return;
      void handleRpc(e.data, deps).then((res) => {
        if (loads.current <= 1) win.postMessage(res, "*");
      });
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

  const onLoad = useCallback(() => {
    loads.current += 1;
    if (loads.current > 1) setStopped(true);
    else sendTheme();
  }, [sendTheme]);

  useEffect(() => {
    const obs = new MutationObserver(sendTheme);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, [sendTheme]);

  useEffect(
    () =>
      useWorkspaceStore.subscribe((s, prev) => {
        if (s.folderPath !== prev.folderPath && loads.current === 1) {
          frame.current?.contentWindow?.postMessage({ type: "md-event", name: "workspace" }, "*");
        }
      }),
    [],
  );

  const readsRuns = manifest.permissions.runs === true;
  useEffect(() => {
    if (!readsRuns) return;
    return useRunReportStore.subscribe((s, prev) => {
      if (s.last && s.last !== prev.last && loads.current === 1) {
        frame.current?.contentWindow?.postMessage(
          { type: "md-event", name: "run.finished", data: s.last },
          "*",
        );
      }
    });
  }, [readsRuns]);

  if (stopped) {
    return (
      <p className="p-4 text-xs text-muted-foreground">
        {manifest.name} navigated away from its own page and was stopped. Close and reopen the panel
        to restart it.
      </p>
    );
  }

  return (
    <iframe
      ref={frame}
      title={manifest.name}
      src={pluginUrl(manifest.id, manifest.entry)}
      sandbox="allow-scripts allow-forms"
      onLoad={onLoad}
      className="min-h-0 w-full flex-1 border-0 bg-background"
    />
  );
}
