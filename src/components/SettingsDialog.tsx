import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { useSettingsStore } from "@/stores/settingsStore";

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Preferences are kept in-memory for now.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
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
