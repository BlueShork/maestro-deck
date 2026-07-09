// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { CheckCircle2, ChevronDown, Copy, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { events, type EnvCheckResult } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { selectPopupVisible, useEnvStore } from "@/stores/envStore";
import { useRunStore } from "@/stores/runStore";

const LABELS: Record<string, string> = {
  maestro: "maestro CLI 2.5.1",
  java: "Java 17+",
  adb: "adb (Android)",
  xcode: "Xcode (iOS)",
};

/** Fallback copy-paste commands for rows without one-click install. */
const MANUAL_COMMANDS: Record<string, string> = {
  maestro: "MAESTRO_VERSION=2.5.1 curl -Ls 'https://get.maestro.mobile.dev' | bash",
  java: "brew install --cask temurin@21",
  adb: "brew install --cask android-platform-tools",
  xcode: "xcode-select --install # or install Xcode from the App Store",
};

const BLOCKING = new Set(["maestro", "java"]);

function StatusIcon({ status }: { status: EnvCheckResult["status"] }) {
  if (status === "ok") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  return <XCircle className="h-3.5 w-3.5 text-red-500" />;
}

function CheckRow({
  check,
  envState,
}: {
  check: EnvCheckResult;
  envState: ReturnType<typeof useEnvStore.getState>;
}) {
  const { installingId, lastInstallLine: lastLine, installError, install } = envState;

  const isBlocking = BLOCKING.has(check.id);
  const failing = check.status !== "ok";
  const installing = installingId === check.id;
  const installable = isBlocking && failing; // maestro + java have one-click installs

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2 text-xs">
        {installing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
        ) : (
          <StatusIcon status={check.status} />
        )}
        <span className={cn("flex-1", !isBlocking && "text-muted-foreground")}>
          {LABELS[check.id] ?? check.id}
          {check.version ? <span className="text-muted-foreground"> — {check.version}</span> : null}
          {check.status === "wrong-version" && check.detail ? (
            <span className="text-amber-500"> ({check.detail})</span>
          ) : null}
        </span>
        {failing && !installing && installable && (
          <button
            type="button"
            onClick={() => void install(check.id as "maestro" | "java")}
            disabled={installingId !== null}
            className="rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Install
          </button>
        )}
        {failing && !installing && (
          <button
            type="button"
            title={MANUAL_COMMANDS[check.id]}
            aria-label={`Copy install command for ${check.id}`}
            onClick={() => void navigator.clipboard.writeText(MANUAL_COMMANDS[check.id] ?? "")}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
      {installing && lastLine && (
        <div className="truncate pl-5 text-[10px] text-muted-foreground">{lastLine}</div>
      )}
      {!installing && installError && installingId === null && failing && isBlocking && (
        <div className="truncate pl-5 text-[10px] text-red-500" title={installError}>
          Install failed — {installError}
        </div>
      )}
    </div>
  );
}

/**
 * Onboarding environment checker. Fixed bottom-right, above toasts (z-70 vs
 * their z-60), below the tour (z-100). Collapsible to a badge but NOT
 * dismissible until the minimal setup (maestro 2.5.1 + Java 17+) passes;
 * once it does, it auto-dismisses forever (Settings → Environment remains).
 *
 * We read store state via getState() / useState initialiser (not the hook) so
 * that node-env renderToStaticMarkup tests can drive the component by calling
 * setState() and observe the correct output. The component subscribes to store
 * changes via its own useState/useEffect so the UI still re-renders in prod.
 */
export function SetupPopup() {
  // Read store state directly so SSR / test environments see whatever setState()
  // has set, not the store's frozen initial snapshot (same pattern as TourOverlay).
  const [envState, setEnvState] = useState(() => useEnvStore.getState());

  useEffect(() => {
    const unsub = useEnvStore.subscribe(setEnvState);
    return unsub;
  }, []);

  const { checks, minimalOk, checking, collapsed, dismissedForever } = envState;
  const visible = selectPopupVisible(envState);
  const { refresh, setCollapsed, dismiss } = envState;
  const wasVisible = useRef(false);

  // Own the startup probe + install event wiring (the component is always
  // mounted from App, even when it renders null).
  useEffect(() => {
    void refresh();
    const subs = Promise.all([
      events.onEnvInstallOutput(({ id, line }) => {
        useEnvStore.getState().onInstallOutput(id, line);
        // Full install log stays reachable in the app console (spec).
        useRunStore.getState().appendLog("system", `[install ${id}] ${line}`);
      }),
      events.onEnvInstallDone(() => void useEnvStore.getState().refresh()),
    ]);
    return () => {
      void subs.then((fns) => fns.forEach((fn) => fn()));
    };
  }, [refresh]);

  // Auto-dismiss 2s after the minimum flips green while the popup is up.
  useEffect(() => {
    if (visible) wasVisible.current = true;
    if (minimalOk === true && wasVisible.current) {
      const t = setTimeout(dismiss, 2000);
      return () => clearTimeout(t);
    }
  }, [minimalOk, visible, dismiss]);

  const showReady = minimalOk === true && wasVisible.current && !dismissedForever;
  if (!visible && !showReady) return null;

  const blockingChecks = checks.filter((c) => BLOCKING.has(c.id));
  const warningChecks = checks.filter((c) => !BLOCKING.has(c.id));
  const okCount = blockingChecks.filter((c) => c.status === "ok").length;

  if (collapsed && !showReady) {
    return (
      <button
        type="button"
        data-setup-popup
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 right-4 z-[70] flex items-center gap-2 rounded-full border border-amber-500/40 bg-card px-3 py-1.5 text-xs shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-amber-500">⚠</span>
        Setup incomplete ({okCount}/{blockingChecks.length})
      </button>
    );
  }

  return (
    <div
      data-setup-popup
      className="fixed bottom-4 right-4 z-[70] w-80 rounded-lg border border-border bg-card p-3 shadow-xl"
    >
      {showReady ? (
        <div className="flex items-center gap-2 text-sm text-emerald-500">
          <CheckCircle2 className="h-4 w-4" /> Environment ready
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold">Setup required</div>
            <button
              type="button"
              aria-label="Collapse"
              onClick={() => setCollapsed(true)}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {blockingChecks.map((c) => (
              <CheckRow key={c.id} check={c} envState={envState} />
            ))}
          </div>
          {warningChecks.length > 0 && (
            <>
              <div className="mb-1.5 mt-2 border-t border-border pt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                Platforms (optional)
              </div>
              <div className="flex flex-col gap-1.5">
                {warningChecks.map((c) => (
                  <CheckRow key={c.id} check={c} envState={envState} />
                ))}
              </div>
            </>
          )}
          <div className="mt-2 flex justify-end border-t border-border pt-2">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={checking}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Re-check
            </button>
          </div>
        </>
      )}
    </div>
  );
}
