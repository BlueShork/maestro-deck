// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/**
 * The host side of the plugin RPC: validates a request from a plugin iframe
 * and routes it to the host capability. Pure — the caller wires `deps` to IPC
 * and the toast store — so every rule here is unit-tested. Rust re-checks
 * http, secrets and open-URL permissions on its side; the checks here only
 * give the plugin a precise error early.
 */

import type { PluginHttpRequest, PluginHttpResponse, PluginManifest } from "./types";

export interface RpcRequest {
  type: "md-rpc";
  id: string;
  method: string;
  params?: unknown;
}

export type RpcResult =
  | { type: "md-rpc-result"; id: string; ok: true; result: unknown }
  | { type: "md-rpc-result"; id: string; ok: false; error: { code: string; message: string } };

export interface ToastRequest {
  kind: "success" | "error" | "info";
  message: string;
  action?: { label: string; url: string };
}

export interface BridgeDeps {
  manifest: PluginManifest;
  secretGet(key: string): Promise<string | null>;
  secretSet(key: string, value: string): Promise<void>;
  secretDelete(key: string): Promise<void>;
  httpFetch(req: PluginHttpRequest): Promise<PluginHttpResponse>;
  openExternal(url: string): Promise<void>;
  /**
   * Resolves whether the plugin may now reach `origin` (already allowed, or
   * the user said yes in the host's dialog). `origin` is normalised.
   */
  requestOrigin(origin: string): Promise<boolean>;
  toast(t: ToastRequest): void;
  appInfo(): { appVersion: string; platform: string };
  storage: Pick<Storage, "getItem" | "setItem">;
  /** The folder open in the app, or null. The plugin never names it. */
  workspaceRoot(): string | null;
  workspaceInfo(root: string | null): Promise<unknown>;
  workspaceChanges(root: string): Promise<unknown[]>;
  workspaceRead(root: string, path: string): Promise<string>;
  /** The last run's report, or null. Plain JSON. */
  latestRun(): unknown;
  copyImage(pngBase64: string): Promise<void>;
  /** Asks the user where to save; false when they cancel. */
  saveFile(name: string, base64: string): Promise<boolean>;
}

const KEY_RE = /^[a-z0-9_-]{1,64}$/;
const STORAGE_MAX = 64 * 1024;
const CODES = ["forbidden", "timeout", "network", "too_large", "bad_request"] as const;

class RpcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function isRpcRequest(data: unknown): data is RpcRequest {
  if (!data || typeof data !== "object") return false;
  const r = data as Record<string, unknown>;
  return (
    r.type === "md-rpc" &&
    typeof r.id === "string" &&
    r.id.length > 0 &&
    r.id.length <= 64 &&
    typeof r.method === "string"
  );
}

export function errorCode(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return CODES.find((c) => message.includes(`${c}:`)) ?? "internal";
}

export const storageKey = (pluginId: string, key: string) =>
  `maestro-deck.plugin.${pluginId}.${key}`;

export function clearPluginStorage(pluginId: string, storage: Storage): void {
  const prefix = `maestro-deck.plugin.${pluginId}.`;
  const doomed: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith(prefix)) doomed.push(k);
  }
  for (const k of doomed) storage.removeItem(k);
}

/** `https://host[:port]` with nothing after it, normalised; null otherwise. */
export function normalizeOrigin(s: string): string | null {
  let u: URL;
  try {
    u = new URL(s.trim());
  } catch {
    return null;
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    return null;
  return u.origin;
}

function obj(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object")
    throw new RpcError("bad_request", "params must be an object");
  return params as Record<string, unknown>;
}

function str(p: Record<string, unknown>, name: string): string {
  const v = p[name];
  if (typeof v !== "string") throw new RpcError("bad_request", `${name} must be a string`);
  return v;
}

function key(p: Record<string, unknown>): string {
  const k = str(p, "key");
  if (!KEY_RE.test(k)) throw new RpcError("bad_request", `invalid key: ${k}`);
  return k;
}

function requireSecrets(deps: BridgeDeps) {
  if (!deps.manifest.permissions.secrets) {
    throw new RpcError("forbidden", "this plugin did not request secret storage");
  }
}

function requireWorkspace(deps: BridgeDeps): void {
  if (!deps.manifest.permissions.workspace) {
    throw new RpcError("forbidden", "this plugin did not request workspace access");
  }
}

function openRoot(deps: BridgeDeps): string {
  const root = deps.workspaceRoot();
  if (!root) throw new RpcError("bad_request", "no folder is open in Maestro Deck");
  return root;
}

function toastRequest(p: Record<string, unknown>): ToastRequest {
  const kind = str(p, "kind");
  if (kind !== "success" && kind !== "error" && kind !== "info")
    throw new RpcError("bad_request", "invalid toast kind");
  const message = str(p, "message").slice(0, 500);
  if (p.action === undefined) return { kind, message };
  const a = obj(p.action);
  const url = str(a, "url");
  if (!url.startsWith("https://"))
    throw new RpcError("bad_request", "toast action url must be https");
  return { kind, message, action: { label: str(a, "label").slice(0, 40), url } };
}

const IMAGE_MAX = 10 * 1024 * 1024;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function requireRuns(deps: BridgeDeps): void {
  if (!deps.manifest.permissions.runs) {
    throw new RpcError("forbidden", "this plugin did not request run reports");
  }
}

function pngParam(p: Record<string, unknown>, name: string): string {
  const v = str(p, name);
  if (v.length > IMAGE_MAX) throw new RpcError("too_large", "image is over 10 MB");
  if (!v.startsWith("iVBORw0KGgo") || !B64_RE.test(v))
    throw new RpcError("bad_request", `${name} must be a base64 PNG`);
  return v;
}

function pngName(p: Record<string, unknown>): string {
  const base = (str(p, "name").split(/[\\/]/).pop() ?? "")
    .replace(/\.png$/i, "")
    .replace(/[^\w.\- ]/g, "_")
    .replace(/^[._ ]+/, "")
    .slice(0, 100)
    .trim();
  if (!base) throw new RpcError("bad_request", "invalid file name");
  return `${base}.png`;
}

async function dispatch(req: RpcRequest, deps: BridgeDeps): Promise<unknown> {
  const id = deps.manifest.id;
  switch (req.method) {
    case "app.info":
      return deps.appInfo();
    case "secrets.get":
      requireSecrets(deps);
      return deps.secretGet(key(obj(req.params)));
    case "secrets.set": {
      requireSecrets(deps);
      const p = obj(req.params);
      await deps.secretSet(key(p), str(p, "value"));
      return null;
    }
    case "secrets.delete":
      requireSecrets(deps);
      await deps.secretDelete(key(obj(req.params)));
      return null;
    case "storage.get": {
      const raw = deps.storage.getItem(storageKey(id, key(obj(req.params))));
      return raw === null ? null : JSON.parse(raw);
    }
    case "storage.set": {
      const p = obj(req.params);
      const json = JSON.stringify(p.value ?? null);
      if (json.length > STORAGE_MAX) throw new RpcError("bad_request", "value is over 64 KB");
      deps.storage.setItem(storageKey(id, key(p)), json);
      return null;
    }
    case "http.fetch": {
      const p = obj(req.params);
      const headers =
        p.headers && typeof p.headers === "object" ? (p.headers as Record<string, string>) : {};
      const body = typeof p.body === "string" ? p.body : undefined;
      return deps.httpFetch({ url: str(p, "url"), method: str(p, "method"), headers, body });
    }
    case "http.requestOrigin": {
      if (!deps.manifest.permissions.userOrigins)
        throw new RpcError("forbidden", "this plugin did not request user-granted origins");
      const raw = str(obj(req.params), "origin");
      const origin = normalizeOrigin(raw);
      if (!origin) throw new RpcError("bad_request", `not an https origin: ${raw}`);
      return deps.requestOrigin(origin);
    }
    case "ui.toast":
      deps.toast(toastRequest(obj(req.params)));
      return null;
    case "ui.openExternal":
      await deps.openExternal(str(obj(req.params), "url"));
      return null;
    case "workspace.info":
      requireWorkspace(deps);
      return deps.workspaceInfo(deps.workspaceRoot());
    case "workspace.changes":
      requireWorkspace(deps);
      return { files: await deps.workspaceChanges(openRoot(deps)) };
    case "workspace.readFile": {
      requireWorkspace(deps);
      const path = str(obj(req.params), "path");
      return { base64: await deps.workspaceRead(openRoot(deps), path) };
    }
    case "runs.latest":
      requireRuns(deps);
      return deps.latestRun();
    case "ui.copyImage":
      await deps.copyImage(pngParam(obj(req.params), "png"));
      return null;
    case "ui.saveFile": {
      const p = obj(req.params);
      return { saved: await deps.saveFile(pngName(p), pngParam(p, "base64")) };
    }
    default:
      throw new RpcError("unknown_method", `unknown method: ${req.method}`);
  }
}

export async function handleRpc(req: RpcRequest, deps: BridgeDeps): Promise<RpcResult> {
  try {
    const result = await dispatch(req, deps);
    return { type: "md-rpc-result", id: req.id, ok: true, result };
  } catch (err) {
    const code = err instanceof RpcError ? err.code : errorCode(err);
    const message =
      err instanceof Error ? err.message.replace(/^IPC \S+ failed: /, "") : String(err);
    return { type: "md-rpc-result", id: req.id, ok: false, error: { code, message } };
  }
}
