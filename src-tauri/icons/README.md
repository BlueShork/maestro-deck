# App icons

Icons used by the Tauri bundler. All files in this directory are derived
from `icon.png` (the single source of truth).

## Current files

- `icon.png` — 128x128 RGBA source image
- `32x32.png`, `128x128.png`, `128x128@2x.png` — PNGs consumed directly on
  Linux and as fallbacks
- `icon.icns` — macOS multi-resolution icon bundle (16→1024 px)
- `icon.ico` — Windows multi-resolution icon (16, 24, 32, 48, 64, 128)

## Regenerating `icon.icns` (macOS only)

Requires the native `sips` and `iconutil` tools that ship with macOS.

```sh
SRC=src-tauri/icons/icon.png
mkdir -p /tmp/icon.iconset
sips -z 16 16     "$SRC" --out /tmp/icon.iconset/icon_16x16.png
sips -z 32 32     "$SRC" --out /tmp/icon.iconset/icon_16x16@2x.png
sips -z 32 32     "$SRC" --out /tmp/icon.iconset/icon_32x32.png
sips -z 64 64     "$SRC" --out /tmp/icon.iconset/icon_32x32@2x.png
sips -z 128 128   "$SRC" --out /tmp/icon.iconset/icon_128x128.png
sips -z 256 256   "$SRC" --out /tmp/icon.iconset/icon_128x128@2x.png
sips -z 256 256   "$SRC" --out /tmp/icon.iconset/icon_256x256.png
sips -z 512 512   "$SRC" --out /tmp/icon.iconset/icon_256x256@2x.png
sips -z 512 512   "$SRC" --out /tmp/icon.iconset/icon_512x512.png
sips -z 1024 1024 "$SRC" --out /tmp/icon.iconset/icon_512x512@2x.png
iconutil -c icns /tmp/icon.iconset -o src-tauri/icons/icon.icns
```

## Regenerating `icon.ico` (any OS)

Requires Python with Pillow (`pip install pillow`).

```sh
python3 - <<'PY'
from PIL import Image
img = Image.open("src-tauri/icons/icon.png").convert("RGBA")
img.save(
    "src-tauri/icons/icon.ico",
    format="ICO",
    sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)],
)
PY
```

Alternatively, `magick icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico`
using ImageMagick works too.

## Alternative: `tauri icon`

If you have a higher-resolution source (ideally 1024x1024), run:

```sh
pnpm tauri icon path/to/source-1024.png
```

This regenerates every size including `icon.icns` and `icon.ico` in one go.
The current source is only 128x128, which is why we regenerate with the
scripts above — upgrading to a 1024x1024 master is a nice future cleanup.
