# Device Screenshot Button — Design

Date: 2026-04-24
Status: Approved

## Goal

Add a one-click screenshot button on top of the mirrored device view in `DeviceView`, saving a PNG of the currently displayed frame into the active workspace folder.

## User flow

1. User connects a device, stream on, frame visible.
2. User clicks the camera icon floating over the device view (or presses `Cmd/Ctrl+Shift+S`).
3. PNG is written to `<workspaceFolder>/screenshots/screenshot-YYYY-MM-DD_HH-mm-ss.png`.
4. Success toast appears with a "Reveal in Finder" action.

## Source

Capture the current `<canvas>` element inside `DeviceView.tsx` via `canvas.toBlob('image/png')`. This gives exactly what the user sees, at scrcpy stream resolution (typically ≤ 1080p wide).

Native-resolution capture via `adb exec-out screencap -p` is explicitly out of scope for this iteration. A follow-up can add it if users ask.

## Destination

- Folder: `screenshots/` subdirectory of `useWorkspaceStore.getState().folderPath`. Created on first capture if missing (`mkdir` with recursive flag from `tauri-plugin-fs`).
- Filename: `screenshot-YYYY-MM-DD_HH-mm-ss.png` — chronological sort order by default.
- Collision: timestamp is second-precision; if two captures land in the same second, append `-2`, `-3`, … by checking `exists` before writing.

## Error cases

- **No workspace folder open** → toast error: "Open a folder first". The button stays visible but the action fails loudly rather than silently falling back to another location.
- **Canvas empty (no frame yet)** → the button only renders when `useStreamStore.hasFrame` is true, so this is unreachable via the UI. Defensive guard still logs and toasts if it ever triggers.
- **Write failure** (permissions, disk full) → toast error with the underlying message.

## UI

- Position: floating top-right of the canvas container in `DeviceView`, with `8px` padding from the corner and `z-index` above the overlay but below the `InspectActionMenu`.
- Style: small square button (~32×32), `lucide-react`'s `Camera` icon, semi-transparent background matching existing button styles in `src/components/ui/`.
- Tooltip: "Screenshot · Cmd+Shift+S" (mac) / "Ctrl+Shift+S" (others).
- Disabled while a capture is in flight (prevents double-fire during the async blob + write).

## Keyboard shortcut

`Cmd/Ctrl+Shift+S`, wired through the existing `useShortcuts` hook in `App.tsx`. Only active when a workspace is open and a frame is visible (same guards as the button).

## "Reveal in Finder"

Use `@tauri-apps/plugin-opener`'s `revealItemInDir` (add the plugin if not already present — currently `tauri-plugin-fs` and `tauri-plugin-dialog` are used, opener is likely not installed yet).

If adding the opener plugin turns out to be non-trivial during implementation, fall back to opening the parent folder with `open` from the existing dialog/fs plugins. The toast action is nice-to-have, not blocking.

## Files touched

- `src/components/DeviceView.tsx` — add button + capture logic (canvas → blob → file write → toast).
- `src/App.tsx` — register `Cmd/Ctrl+Shift+S` shortcut, call the same capture function.
- `src-tauri/Cargo.toml` / `src-tauri/capabilities/*` — only if the opener plugin is added.

No Rust code changes required for the core feature.

## Out of scope

- Native-resolution capture via `adb screencap`.
- Clipboard copy.
- Screenshot history / gallery.
- Annotation or cropping.
- Multi-device capture.
