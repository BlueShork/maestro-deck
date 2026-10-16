// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/**
 * A stand-in for the Tauri backend, injected into the page before the app
 * loads (`page.addInitScript`). The real frontend runs unchanged; every IPC
 * call lands here, answered from the test's `Scenario`, and is recorded so a
 * test can assert what the app asked the backend to do. Events (runner output,
 * frames, quit requests…) are pushed with `window.__e2e.emit`.
 *
 * Playwright serialises `installTauriMock` into the page, so it must not close
 * over anything outside its own body.
 */

export interface DialogQueues {
  /** Successive answers to `open()`; null = cancelled. */
  open?: Array<string | null>;
  save?: Array<string | null>;
  /** Successive button labels returned by `message()` / `ask()`. */
  message?: string[];
}

export interface Scenario {
  devices?: unknown[];
  /** Virtual file system: absolute path → text content. */
  files?: Record<string, string>;
  /** Workspace listings, by folder path. */
  trees?: Record<string, unknown>;
  dialogs?: DialogQueues;
  /** Static answers for any command, by name (wins over the defaults). */
  responses?: Record<string, unknown>;
  /** Commands that reject, by name → error message. */
  failures?: Record<string, string>;
  /** Pre-seeded localStorage entries (zustand persist blobs, etc.). */
  storage?: Record<string, string>;
  credentials?: Record<string, string>;
  deferred?: string[];
  cloudApi?: Record<string, CloudReply | CloudReply[]>;
}

export interface CloudReply {
  status: number;
  body: string;
}

export interface RecordedCall {
  cmd: string;
  args: unknown;
}

export function installTauriMock(scenario: Scenario): void {
  const w = window as unknown as Record<string, unknown>;
  const state = {
    files: { ...(scenario.files ?? {}) } as Record<string, string>,
    dirs: new Set<string>(),
    devices: scenario.devices ?? [],
    trees: scenario.trees ?? {},
    dialogs: {
      open: [...(scenario.dialogs?.open ?? [])],
      save: [...(scenario.dialogs?.save ?? [])],
      message: [...(scenario.dialogs?.message ?? [])],
    },
    responses: { ...(scenario.responses ?? {}) } as Record<string, unknown>,
    failures: { ...(scenario.failures ?? {}) } as Record<string, string>,
    credentials: { ...(scenario.credentials ?? {}) } as Record<string, string>,
    cloudApi: { ...(scenario.cloudApi ?? {}) } as Record<string, CloudReply | CloudReply[]>,
    deferred: new Set(scenario.deferred ?? []),
    pending: new Map<
      string,
      Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }>
    >(),
    calls: [] as Array<{ cmd: string; args: unknown }>,
    listeners: new Map<string, number[]>(),
    callbacks: new Map<number, (data: unknown) => void>(),
    nextCallback: 1,
    nextEventId: 1,
  };

  if (scenario.storage) {
    for (const [k, v] of Object.entries(scenario.storage)) {
      if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    }
  }

  const PNG_1PX =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  const encode = (s: string) => Array.from(new TextEncoder().encode(s));
  const decode = (data: unknown) =>
    new TextDecoder().decode(
      data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBufferLike),
    );
  const parent = (p: string) => p.replace(/[/\\][^/\\]*$/, "");

  function emit(event: string, payload: unknown): void {
    for (const id of state.listeners.get(event) ?? []) {
      state.callbacks.get(id)?.({ event, id: state.nextEventId++, payload });
    }
  }

  function listDir(dir: string): unknown {
    const dirs = new Set<string>();
    const files = new Set<string>();
    const entries = [...Object.keys(state.files), ...[...state.dirs].map((d) => `${d}/`)];
    for (const k of entries) {
      if (!k.startsWith(`${dir}/`)) continue;
      const rest = k.slice(dir.length + 1);
      const first = rest.split("/")[0];
      if (!first || first.startsWith(".")) continue;
      if (rest.includes("/")) dirs.add(first);
      else if (/\.ya?ml$/i.test(first)) files.add(first);
    }
    const name = dir.split("/").pop();
    const sorted = (set: Set<string>) => [...set].sort();
    return {
      kind: "dir",
      name,
      path: dir,
      children: [
        ...sorted(dirs).map((d) => listDir(`${dir}/${d}`)),
        ...sorted(files).map((f) => ({ kind: "file", name: f, path: `${dir}/${f}` })),
      ],
    };
  }

  function defaults(cmd: string, a: Record<string, unknown>, headers: Record<string, string>) {
    switch (cmd) {
      // ── Tauri core / plugins ────────────────────────────────────────────
      case "plugin:event|listen": {
        const list = state.listeners.get(a.event as string) ?? [];
        list.push(a.handler as number);
        state.listeners.set(a.event as string, list);
        return a.handler;
      }
      case "plugin:event|unlisten": {
        const list = state.listeners.get(a.event as string) ?? [];
        state.listeners.set(
          a.event as string,
          list.filter((h) => h !== a.eventId && h !== a.id),
        );
        return null;
      }
      case "plugin:event|emit":
        emit(a.event as string, a.payload);
        return null;
      case "plugin:fs|read_text_file": {
        const text = state.files[a.path as string];
        if (text === undefined) throw new Error(`No such file or directory: ${a.path}`);
        return encode(text);
      }
      case "plugin:fs|write_text_file":
      case "plugin:fs|write_file": {
        const path = decodeURIComponent(headers.path);
        state.files[path] = decode(a);
        return null;
      }
      case "plugin:fs|exists": {
        const p = a.path as string;
        return (
          p in state.files ||
          state.dirs.has(p) ||
          Object.keys(state.files).some((k) => k.startsWith(`${p}/`))
        );
      }
      case "plugin:fs|mkdir":
        state.dirs.add(a.path as string);
        return null;
      case "plugin:fs|remove": {
        const p = a.path as string;
        for (const k of Object.keys(state.files)) {
          if (k === p || k.startsWith(`${p}/`)) delete state.files[k];
        }
        for (const d of [...state.dirs]) if (d === p || d.startsWith(`${p}/`)) state.dirs.delete(d);
        return null;
      }
      case "plugin:fs|rename": {
        const from = a.oldPath as string;
        const to = a.newPath as string;
        for (const k of Object.keys(state.files)) {
          if (k === from || k.startsWith(`${from}/`)) {
            state.files[to + k.slice(from.length)] = state.files[k];
            delete state.files[k];
          }
        }
        for (const d of [...state.dirs]) {
          if (d === from || d.startsWith(`${from}/`)) {
            state.dirs.delete(d);
            state.dirs.add(to + d.slice(from.length));
          }
        }
        return null;
      }
      case "plugin:dialog|open":
        return state.dialogs.open.shift() ?? null;
      case "plugin:dialog|save":
        return state.dialogs.save.shift() ?? null;
      case "plugin:dialog|message":
        return state.dialogs.message.shift() ?? "Cancel";
      case "plugin:path|resolve_directory":
        return "/tmp";
      case "plugin:path|join":
        return (a.paths as string[]).join("/").replace(/\/+/g, "/");
      case "plugin:path|dirname":
        return parent(a.path as string);
      case "plugin:path|basename":
        return (a.path as string).split(/[/\\]/).pop();
      case "plugin:app|version":
        return "1.2.0";
      case "plugin:updater|check":
        return null;

      // ── Maestro Deck commands ───────────────────────────────────────────
      case "app_version":
        return "1.2.0";
      case "list_devices":
        return state.devices;
      case "connect_device": {
        const d = (state.devices as Array<{ serial: string }>).find((x) => x.serial === a.serial);
        if (!d) throw new Error(`device ${a.serial} not found`);
        return d;
      }
      case "environment_status":
        return { checks: [], minimalOk: true };
      case "managed_tools":
        return {};
      case "list_workspace": {
        if (!state.trees[a.path as string]) throw new Error(`cannot read ${a.path}`);
        return listDir(a.path as string);
      }
      case "run_flow":
        return 4242;
      case "cloud_api_request": {
        const reply = state.cloudApi[`${a.method} ${a.path}`];
        if (!reply) return { status: 404, body: '{"error":"not_found","message":"no such route"}' };
        if (!Array.isArray(reply)) return reply;
        return reply.length > 1 ? reply.shift() : reply[0];
      }
      case "get_credential":
        return state.credentials[a.provider as string] ?? null;
      case "save_credential":
        state.credentials[a.provider as string] = a.payload as string;
        return null;
      case "delete_credential":
        delete state.credentials[a.provider as string];
        return null;
      case "read_workspace_file": {
        const text = state.files[`${a.workspace}/${a.relPath}`];
        if (text === undefined) throw new Error(`no such flow: ${a.relPath}`);
        return text;
      }
      case "write_workspace_file":
        state.files[`${a.workspace}/${a.relPath}`] = a.content as string;
        return null;
      case "plugins_list":
        return [];
      case "plugins_registry":
        return JSON.stringify({ version: 1, plugins: [] });
      case "get_tool_paths":
      case "set_tool_paths":
        return {
          overrides: {
            adb: null,
            maestro: null,
            iproxy: null,
            apple_team_id: null,
            maestro_ios_device: null,
          },
          resolved_adb: "/opt/homebrew/bin/adb",
          resolved_maestro: "/Users/me/.maestro/bin/maestro",
          resolved_iproxy: "/opt/homebrew/bin/iproxy",
          resolved_maestro_ios_device: "",
        };
      case "list_bank":
        return [];
      case "load_bank_image":
        return `data:image/png;base64,${PNG_1PX}`;
      case "get_dark_mode":
        return false;
      case "suggest_selectors":
        return [];
      case "generate_command":
        return "- tapOn: x\n";
      case "ios_device_bridge_installed":
        return false;
      case "workspace_git_branch":
        return null;
      default:
        return null;
    }
  }

  async function invoke(
    cmd: string,
    args?: unknown,
    options?: { headers?: Record<string, string> },
  ) {
    const a = (args ?? {}) as Record<string, unknown>;
    if (!cmd.startsWith("plugin:event|")) {
      state.calls.push({
        cmd,
        args:
          args instanceof Uint8Array || args instanceof ArrayBuffer
            ? { body: decode(args), ...(options?.headers ?? {}) }
            : args,
      });
    }
    if (state.deferred.has(cmd)) {
      return new Promise((resolve, reject) => {
        const list = state.pending.get(cmd) ?? [];
        list.push({ resolve, reject });
        state.pending.set(cmd, list);
      });
    }
    if (cmd in state.failures) throw new Error(state.failures[cmd]);
    if (cmd in state.responses) return state.responses[cmd];
    return defaults(cmd, a, options?.headers ?? {});
  }

  w.isTauri = true;
  w.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback(cb?: (data: unknown) => void, once = false) {
      const id = state.nextCallback++;
      state.callbacks.set(id, (data) => {
        if (once) state.callbacks.delete(id);
        cb?.(data);
      });
      return id;
    },
    unregisterCallback(id: number) {
      state.callbacks.delete(id);
    },
    runCallback(id: number, data: unknown) {
      state.callbacks.get(id)?.(data);
    },
    callbacks: state.callbacks,
    convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    plugins: {},
  };
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event: string, id: number) {
      state.callbacks.delete(id);
      const list = state.listeners.get(event) ?? [];
      state.listeners.set(
        event,
        list.filter((h) => h !== id),
      );
    },
  };
  w.__e2e = {
    emit,
    settle(cmd: string, value: unknown, error?: string) {
      for (const p of state.pending.get(cmd) ?? []) {
        if (error !== undefined) p.reject(new Error(error));
        else p.resolve(value);
      }
      state.pending.delete(cmd);
    },
    state,
    calls: (cmd?: string) => state.calls.filter((c) => !cmd || c.cmd === cmd),
  };
}
