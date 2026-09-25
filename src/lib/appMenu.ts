// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { pickWorkspaceFolder } from "@/lib/flow-io";
import { events, ipc } from "@/lib/ipc";
import { IS_MAC } from "@/lib/keyboard";
import { useChatStore } from "@/stores/chatStore";
import { useInspectorStore } from "@/stores/inspectorStore";
import { usePanelsStore, type PanelId } from "@/stores/panelsStore";
import { useUpdateStore } from "@/stores/updateStore";

const DOCS_URL = "https://www.maestrodeck.cloud/docs";

interface RunHandlers {
  onRun: () => void;
  onRunAll: () => void;
  onStop: () => void;
}

/**
 * Wires the macOS menu bar (src-tauri/src/app_menu.rs) to the app: runs the
 * action behind each clicked item and keeps the check items (panels, inspect,
 * AI assistant) ticked to match the stores. Mount once, in MainView — it is
 * always mounted, so the menu works from the settings pages too.
 */
export function useAppMenu(handlers: RunHandlers): void {
  const navigate = useNavigate();
  // The listener is registered once; read the latest callbacks through a ref.
  const latest = useRef({ ...handlers, navigate });
  latest.current = { ...handlers, navigate };

  useEffect(() => {
    if (!IS_MAC) return;
    const unlisten = events.onMenuAction((id) => {
      const { onRun, onRunAll, onStop, navigate } = latest.current;
      // Actions that act on the main view bring it back from a subpage first.
      const home = () => navigate("/");
      const flowCommand = (detail: "save" | "save-as" | "open") =>
        window.dispatchEvent(new CustomEvent("flow:command", { detail }));

      if (id.startsWith("panel:")) {
        home();
        usePanelsStore.getState().toggle(id.slice("panel:".length) as PanelId);
        return;
      }
      switch (id) {
        case "check-updates":
          void useUpdateStore.getState().check();
          break;
        case "settings":
          navigate("/settings");
          break;
        case "account":
          navigate("/account");
          break;
        case "image-bank":
          navigate("/image-bank");
          break;
        case "open-folder":
          home();
          void pickWorkspaceFolder();
          break;
        case "open-file":
          home();
          flowCommand("open");
          break;
        case "save":
          flowCommand("save");
          break;
        case "save-as":
          flowCommand("save-as");
          break;
        case "run":
          home();
          onRun();
          break;
        case "run-all":
          home();
          onRunAll();
          break;
        case "stop":
          onStop();
          break;
        case "inspect":
          home();
          // Entering can fail, leaving `enabled` unchanged — and so the tick
          // AppKit already flipped. Re-sync once the toggle settles.
          void useInspectorStore
            .getState()
            .toggle()
            .finally(() =>
              ipc.setMenuChecked("inspect", useInspectorStore.getState().enabled).catch(() => {}),
            );
          break;
        case "show-all-panels":
          home();
          usePanelsStore.getState().showAll();
          break;
        case "ai-assistant":
          home();
          useChatStore.getState().toggle();
          break;
        case "docs":
          void openUrl(DOCS_URL);
          break;
      }
    });
    return () => void unlisten.then((u) => u());
  }, []);

  // AppKit flips a check item's tick on click before the store changes, and
  // the store also changes from the toolbar — so always push the store's
  // state back, which settles both cases.
  useEffect(() => {
    if (!IS_MAC) return;
    const sync = (id: string, checked: boolean) =>
      void ipc.setMenuChecked(id, checked).catch(() => {});
    const syncPanels = (visible: Record<PanelId, boolean>) => {
      for (const [panel, on] of Object.entries(visible)) sync(`panel:${panel}`, on);
    };
    syncPanels(usePanelsStore.getState().visible);
    sync("inspect", useInspectorStore.getState().enabled);
    sync("ai-assistant", useChatStore.getState().isOpen);
    const unsubs = [
      usePanelsStore.subscribe((s, prev) => {
        if (s.visible !== prev.visible) syncPanels(s.visible);
      }),
      useInspectorStore.subscribe((s, prev) => {
        if (s.enabled !== prev.enabled) sync("inspect", s.enabled);
      }),
      useChatStore.subscribe((s, prev) => {
        if (s.isOpen !== prev.isOpen) sync("ai-assistant", s.isOpen);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);
}
