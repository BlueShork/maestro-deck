// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { PanelId } from "@/stores/panelsStore";

export interface TourStep {
  id: string;
  /** Matched at runtime as `[data-tour="<target>"]`. */
  target: string;
  /** Panels to open (via panelsStore.show) before measuring the target. */
  requiresPanel: PanelId[];
  title: string;
  /** Body copy. The token `{inspectKey}` is replaced with the live inspect key. */
  body: string;
  placement: "top" | "bottom" | "left" | "right";
  /** True when the step only describes a feature and implies no user action. */
  informational?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "device",
    target: "inspector",
    requiresPanel: ["inspector"],
    title: "Connect your phone",
    body: "Plug in your Android phone over USB and pick it here. No phone right now? Skip ahead — you can come back anytime.",
    placement: "right",
  },
  {
    id: "mirror",
    target: "device",
    requiresPanel: ["device"],
    title: "Mirror & inspect",
    body: "A live, touchable mirror of your phone. Toggle Inspect mode (press {inspectKey}) to explore the UI hierarchy element by element.",
    placement: "right",
  },
  {
    id: "editor",
    target: "editor",
    requiresPanel: ["workspace", "editor"],
    title: "Build your flow",
    body: "The file tree and editor are where you write and edit Maestro flows. Open a folder to keep your flows organized.",
    placement: "left",
  },
  {
    id: "run",
    target: "run-controls",
    requiresPanel: [],
    title: "Run it",
    body: "Run the current flow, Run All in the workspace, or Stop — the console below streams every step live as it executes.",
    placement: "bottom",
  },
  {
    id: "chat",
    target: "chat-toggle",
    requiresPanel: [],
    title: "AI assistant",
    body: "An AI assistant can help you write and fix flows. It lives here — you'll add your provider credentials later in Settings.",
    placement: "bottom",
    informational: true,
  },
  {
    id: "image-bank",
    target: "image-bank",
    requiresPanel: [],
    title: "Image bank",
    body: "Save screenshots from your runs into a bank, then compare new captures against them to catch visual regressions.",
    placement: "bottom",
    informational: true,
  },
];
