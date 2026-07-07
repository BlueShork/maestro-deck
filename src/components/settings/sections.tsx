// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { ReactNode } from "react";

import { AiSettings } from "@/components/AiSettings";
import { ToolPathsSettings } from "@/components/ToolPathsSettings";
import { AboutSettings } from "@/components/settings/AboutSettings";
import { BillySettings } from "@/components/settings/BillySettings";
import { VisualRegressionSettings } from "@/components/settings/VisualRegressionSettings";
import { DevicePerformanceSettings } from "@/components/settings/DevicePerformanceSettings";
import { GeneralSettings } from "@/components/settings/GeneralSettings";

export interface SettingsSectionDef {
  id: string;
  label: string;
  render: () => ReactNode;
}

/** Order = top→bottom in the sidebar. The `id` is the `:section` URL segment. */
export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  { id: "general", label: "General", render: () => <GeneralSettings /> },
  { id: "device", label: "Device & Performance", render: () => <DevicePerformanceSettings /> },
  { id: "tools", label: "Tools", render: () => <ToolPathsSettings /> },
  { id: "ai", label: "AI", render: () => <AiSettings /> },
  { id: "billy", label: "Billy AI", render: () => <BillySettings /> },
  {
    id: "visual-regression",
    label: "Visual Regression",
    render: () => <VisualRegressionSettings />,
  },
  { id: "about", label: "About", render: () => <AboutSettings /> },
];

/** Resolve the active section from the URL, falling back to the first one for
 *  unknown/missing segments. */
export function resolveSection(section: string | undefined): SettingsSectionDef {
  return SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0];
}
