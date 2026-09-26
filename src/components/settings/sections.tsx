// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import {
  Bot,
  Code2,
  Images,
  Info,
  type LucideIcon,
  MonitorSmartphone,
  Settings2,
  ShieldCheck,
  Smartphone,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";

import { AboutSettings } from "@/components/settings/AboutSettings";
import { BillySettings } from "@/components/settings/BillySettings";
import { DevicePerformanceSettings } from "@/components/settings/DevicePerformanceSettings";
import { EditorSettings } from "@/components/settings/EditorSettings";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { PhysicalIphoneSettings } from "@/components/settings/PhysicalIphoneSettings";
import { PrivacySettings } from "@/components/settings/PrivacySettings";
import { ToolchainSettings } from "@/components/settings/ToolchainSettings";
import { VisualRegressionSettings } from "@/components/settings/VisualRegressionSettings";

export interface SettingsSectionDef {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Sidebar heading the section is listed under; null = ungrouped (About). */
  group: string | null;
  render: () => ReactNode;
}

/** Order = top→bottom in the sidebar. The `id` is the `:section` URL segment. */
export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: "general",
    label: "General",
    icon: Settings2,
    group: "App",
    render: () => <GeneralSettings />,
  },
  {
    id: "privacy",
    label: "Privacy",
    icon: ShieldCheck,
    group: "App",
    render: () => <PrivacySettings />,
  },
  {
    id: "editor",
    label: "Editor & Flows",
    icon: Code2,
    group: "Workspace",
    render: () => <EditorSettings />,
  },
  {
    id: "device",
    label: "Devices & Performance",
    icon: MonitorSmartphone,
    group: "Devices",
    render: () => <DevicePerformanceSettings />,
  },
  {
    id: "iphone",
    label: "Physical iPhone",
    icon: Smartphone,
    group: "Devices",
    render: () => <PhysicalIphoneSettings />,
  },
  {
    id: "toolchain",
    label: "Toolchain",
    icon: Wrench,
    group: "Devices",
    render: () => <ToolchainSettings />,
  },
  {
    id: "ai",
    label: "Billy AI",
    icon: Bot,
    group: "Features",
    render: () => <BillySettings />,
  },
  {
    id: "visual-regression",
    label: "Visual Regression",
    icon: Images,
    group: "Features",
    render: () => <VisualRegressionSettings />,
  },
  { id: "about", label: "About", icon: Info, group: null, render: () => <AboutSettings /> },
];

/** Section ids from before the reorganisation, so old links still land right. */
const LEGACY_IDS: Record<string, string> = {
  tools: "toolchain",
  environment: "toolchain",
  billy: "ai",
};

/** Resolve the active section from the URL, falling back to the first one for
 *  unknown/missing segments. */
export function resolveSection(section: string | undefined): SettingsSectionDef {
  const id = section ? (LEGACY_IDS[section] ?? section) : undefined;
  return SETTINGS_SECTIONS.find((s) => s.id === id) ?? SETTINGS_SECTIONS[0];
}
