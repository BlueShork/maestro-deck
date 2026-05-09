#!/usr/bin/env bash
# Notarize and staple every DMG produced by `tauri build`.
#
# Usage: scripts/notarize-dmg.sh
#
# Reads APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID from .env.signing in the
# project root. Submits each DMG under src-tauri/target/release/bundle/dmg/
# to Apple, waits for the verdict, and staples the ticket on success.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env.signing ]]; then
  echo "error: .env.signing not found in project root" >&2
  exit 1
fi

# shellcheck disable=SC1091
source .env.signing

: "${APPLE_ID:?APPLE_ID missing in .env.signing}"
: "${APPLE_PASSWORD:?APPLE_PASSWORD missing in .env.signing}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID missing in .env.signing}"

DMG_DIR="src-tauri/target/release/bundle/dmg"
if [[ ! -d "$DMG_DIR" ]]; then
  echo "error: $DMG_DIR not found — run \`pnpm tauri:build\` first" >&2
  exit 1
fi

shopt -s nullglob
dmgs=("$DMG_DIR"/*.dmg)
if [[ ${#dmgs[@]} -eq 0 ]]; then
  echo "error: no .dmg files in $DMG_DIR" >&2
  exit 1
fi

for dmg in "${dmgs[@]}"; do
  echo "==> Submitting $(basename "$dmg") to Apple notary service"
  xcrun notarytool submit "$dmg" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait

  echo "==> Stapling ticket to $(basename "$dmg")"
  xcrun stapler staple "$dmg"

  echo "==> Verifying"
  xcrun stapler validate "$dmg"
  spctl -a -vvv -t open --context context:primary-signature "$dmg"
done

echo "All DMGs notarized and stapled."
