// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { ipc } from "@/lib/ipc";
import { clearPluginStorage } from "@/lib/plugins/bridge";
import { parseRegistry } from "@/lib/plugins/registry";
import type { InstalledPlugin, RegistryEntry } from "@/lib/plugins/types";
import { useChatStore } from "@/stores/chatStore";
import { toast } from "@/stores/toastStore";

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^IPC \S+ failed: /, "");

interface PluginsState {
  installed: InstalledPlugin[];
  registry: RegistryEntry[];
  registryError: string | null;
  registryLoading: boolean;
  /** Plugin ids with an install/uninstall in flight. */
  busy: Record<string, boolean>;
  /** Plugin whose panel fills the right-hand slot (shared with Billy). */
  openPanel: string | null;
  refreshInstalled: () => Promise<void>;
  refreshRegistry: () => Promise<void>;
  install: (entry: RegistryEntry) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
  loadDev: (path: string) => Promise<void>;
  openPluginPanel: (id: string) => void;
  closePluginPanel: () => void;
  togglePluginPanel: (id: string) => void;
}

export const usePluginsStore = create<PluginsState>()(
  persist(
    (set, get) => {
      const setBusy = (id: string, on: boolean) => set((s) => ({ busy: { ...s.busy, [id]: on } }));
      return {
        installed: [],
        registry: [],
        registryError: null,
        registryLoading: false,
        busy: {},
        openPanel: null,
        refreshInstalled: async () => {
          try {
            set({ installed: await ipc.pluginsList() });
          } catch (err) {
            toast.error("Could not read installed plugins", message(err));
          }
        },
        refreshRegistry: async () => {
          set({ registryLoading: true });
          try {
            set({ registry: parseRegistry(await ipc.pluginsRegistry()), registryError: null });
          } catch (err) {
            set({ registryError: message(err) });
          } finally {
            set({ registryLoading: false });
          }
        },
        install: async (entry) => {
          setBusy(entry.id, true);
          try {
            await ipc.pluginsInstall({
              id: entry.id,
              version: entry.version,
              url: entry.url,
              sha256: entry.sha256,
            });
            await get().refreshInstalled();
            toast.success(`${entry.name} ${entry.version} installed`);
          } catch (err) {
            toast.error(`Could not install ${entry.name}`, message(err));
          } finally {
            setBusy(entry.id, false);
          }
        },
        uninstall: async (id) => {
          setBusy(id, true);
          try {
            if (get().openPanel === id) set({ openPanel: null });
            await ipc.pluginsUninstall(id);
            clearPluginStorage(id, localStorage);
            await get().refreshInstalled();
          } catch (err) {
            toast.error("Could not uninstall the plugin", message(err));
          } finally {
            setBusy(id, false);
          }
        },
        loadDev: async (path) => {
          try {
            const m = await ipc.pluginsLoadDev(path);
            await get().refreshInstalled();
            toast.success(`Loaded ${m.name} from ${path}`);
          } catch (err) {
            toast.error("Could not load the local plugin", message(err));
          }
        },
        openPluginPanel: (id) => {
          useChatStore.getState().setOpen(false);
          set({ openPanel: id });
        },
        closePluginPanel: () => set({ openPanel: null }),
        togglePluginPanel: (id) => {
          if (get().openPanel === id) get().closePluginPanel();
          else get().openPluginPanel(id);
        },
      };
    },
    {
      name: "maestro-deck.plugins",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({ openPanel: s.openPanel }),
    },
  ),
);

// Billy opening (toolbar, compose from a step menu, …) takes the slot back.
useChatStore.subscribe((s, prev) => {
  if (s.isOpen && !prev.isOpen && usePluginsStore.getState().openPanel !== null) {
    usePluginsStore.getState().closePluginPanel();
  }
});
