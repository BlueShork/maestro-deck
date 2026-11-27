#!/usr/bin/env bash
# Copyright (c) 2026 Ethan Morisset
# SPDX-License-Identifier: BUSL-1.1
#
# Captures the screen currently shown on an Android device as an a11y
# pre-audit fixture: the Maestro hierarchy (JSON, read by
# `hierarchy::parse_maestro_json`) and a PNG screenshot.
#
#   scripts/a11y-capture-fixture.sh <app> <screen>
#
# Writes src-tauri/src/a11y/fixtures/android/<app>/<screen>.{json,png}.
# Needs `maestro` and `adb` on the PATH. Set ANDROID_SERIAL to pick a device
# (defaults to the only one connected).
set -euo pipefail

APP="${1:?usage: $0 <app> <screen>}"
SCREEN="${2:?usage: $0 <app> <screen>}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$HERE/src-tauri/src/a11y/fixtures/android/$APP"
SERIAL="${ANDROID_SERIAL:-$(adb get-serialno)}"
mkdir -p "$DIR"

# `maestro hierarchy` can print log lines before the JSON, so keep
# everything from the first `{`.
maestro --device "$SERIAL" hierarchy 2>/dev/null | sed -n '/^{/,$p' > "$DIR/$SCREEN.json"
adb -s "$SERIAL" exec-out screencap -p > "$DIR/$SCREEN.png"

python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$DIR/$SCREEN.json" \
  || { echo "invalid hierarchy JSON for $APP/$SCREEN" >&2; exit 1; }
echo "captured: $DIR/$SCREEN.{json,png}"
