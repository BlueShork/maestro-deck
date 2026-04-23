import { Monitor, Moon, Sun } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";
import { useSettingsStore, type ThemeMode } from "@/stores/settingsStore";

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const showFps = useSettingsStore((s) => s.showFps);
  const setShowFps = useSettingsStore((s) => s.setShowFps);
  const inspectKey = useSettingsStore((s) => s.inspectKey);
  const setInspectKey = useSettingsStore((s) => s.setInspectKey);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Theme and shortcut preferences are saved locally.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">Theme</span>
            <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
                const active = theme === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTheme(value)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                      active
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={active}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex items-center justify-between">
            <span>Show FPS counter</span>
            <input
              type="checkbox"
              checked={showFps}
              onChange={(e) => setShowFps(e.currentTarget.checked)}
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>Inspect shortcut key</span>
            <input
              type="text"
              value={inspectKey}
              maxLength={1}
              onChange={(e) =>
                setInspectKey(e.currentTarget.value.toLowerCase() || "i")
              }
              className="w-12 rounded border border-border bg-background px-2 py-1 text-center font-mono text-xs"
            />
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
