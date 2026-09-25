# App icons

Icons used by the Tauri bundler, all rendered from two SVG masters:

- `icon.svg` — full-bleed app icon (black rounded square, white mark). Source
  for the Windows/Linux PNGs and `icon.ico`.
- `icon-macos.svg` — same icon on Apple's grid (824px body centred on a
  1024 canvas), so it sits at the right size in the Dock. Source for
  `icon.icns` and `icon.png`.

## Regenerating (macOS; needs `rsvg-convert`, `iconutil`, Pillow)

```sh
cd src-tauri/icons
for s in 32 128; do rsvg-convert -w $s -h $s icon.svg -o ${s}x${s}.png; done
rsvg-convert -w 256 -h 256 icon.svg -o 128x128@2x.png
rsvg-convert -w 1024 -h 1024 icon-macos.svg -o icon.png

mkdir -p /tmp/icon.iconset
for s in 16 32 128 256 512; do
  rsvg-convert -w $s -h $s icon-macos.svg -o /tmp/icon.iconset/icon_${s}x${s}.png
  rsvg-convert -w $((s*2)) -h $((s*2)) icon-macos.svg -o /tmp/icon.iconset/icon_${s}x${s}@2x.png
done
iconutil -c icns /tmp/icon.iconset -o icon.icns

rsvg-convert -w 256 -h 256 icon.svg -o /tmp/ico-src.png
python3 -c "from PIL import Image; Image.open('/tmp/ico-src.png').convert('RGBA').save('icon.ico', format='ICO', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"
```
