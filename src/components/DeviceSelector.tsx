import { Plug, PlugZap, RefreshCw, Smartphone } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { useDeviceStore } from "@/stores/deviceStore";

export function DeviceSelector() {
  const { devices, current, loading, connecting, error, refresh, connect, disconnect } =
    useDeviceStore();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-2 border-b border-border p-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Devices
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh devices"
          className="h-6 w-6"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {error ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive-foreground">
          {error}
        </div>
      ) : null}

      {!loading && devices.length === 0 && !error ? (
        <div className="rounded border border-dashed border-border p-2 text-[11px] text-muted-foreground">
          No devices found. Plug in an Android device with USB debugging
          enabled.
        </div>
      ) : null}

      <ul className="flex flex-col gap-1">
        {devices.map((d) => {
          const active = current?.serial === d.serial;
          return (
            <li key={d.serial}>
              <button
                type="button"
                onClick={() =>
                  active ? void disconnect() : void connect(d.serial)
                }
                disabled={connecting}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors",
                  active
                    ? "border-primary/40 bg-primary/10"
                    : "hover:border-border hover:bg-accent/40",
                )}
              >
                <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{d.model}</div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">
                    {d.serial} · Android {d.android_version}
                  </div>
                </div>
                {active ? (
                  <PlugZap className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Plug className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
