// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

export const THEME_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "surface",
  "muted",
  "muted-foreground",
  "border",
  "input",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "ring",
  "brand",
  "brand-foreground",
  "success",
  "warning",
] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];
export type ThemeTokens = Partial<Record<ThemeToken, string>>;
export interface PluginTheme {
  light?: ThemeTokens;
  dark?: ThemeTokens;
  radius?: string;
}

export interface PluginPermissions {
  http: string[];
  open: string[];
  secrets: boolean;
  workspace?: boolean;
  userOrigins?: boolean;
}
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  entry?: string | null;
  theme?: string | null;
  icon?: string | null;
  panel?: { title: string } | null;
  permissions: PluginPermissions;
}
export interface InstalledPlugin {
  id: string;
  version: string;
  dev: boolean;
  manifest: PluginManifest | null;
  error: string | null;
  grantedOrigins?: string[];
  theme?: PluginTheme | null;
}
export interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  repo: string;
  version: string;
  minAppVersion: string;
  url: string;
  sha256: string;
  kind?: "plugin" | "theme";
}
export type CatalogStatus = "available" | "installed" | "update" | "incompatible" | "broken";
export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  registry: RegistryEntry | null;
  installed: InstalledPlugin | null;
  status: CatalogStatus;
  isTheme: boolean;
}
export interface PluginHttpRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface PluginHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export interface PluginWorkspaceInfo {
  name: string;
  git: {
    branch: string | null;
    head: string | null;
    github: { owner: string; repo: string } | null;
    remote: { host: string; path: string } | null;
  } | null;
}
export interface PluginWorkspaceChange {
  path: string;
  status: "added" | "modified" | "deleted";
  size: number;
  executable: boolean;
}
