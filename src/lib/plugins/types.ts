// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

export interface PluginPermissions {
  http: string[];
  open: string[];
  secrets: boolean;
  workspace?: boolean;
}
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  entry: string;
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
}
export type CatalogStatus = "available" | "installed" | "update" | "incompatible" | "broken";
export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  registry: RegistryEntry | null;
  installed: InstalledPlugin | null;
  status: CatalogStatus;
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
