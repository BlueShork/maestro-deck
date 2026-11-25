#!/usr/bin/env bash
# Copyright (c) 2026 Ethan Morisset
# SPDX-License-Identifier: BUSL-1.1
#
# Builds the deliberately inaccessible fixture app into out/a11y-bad-app.apk.
#
# Same Gradle-free toolchain as ../sample-app/build.sh. The APK is not
# committed: only the screens captured from it are, as fixtures of the
# accessibility pre-audit (src-tauri/src/a11y/fixtures/). Rebuild it by hand
# to recapture them.
#
# Requires: an Android SDK with build-tools and a platform, plus a JDK.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
BT="$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)"
AJ="$(ls -d "$SDK"/platforms/*/android.jar 2>/dev/null | sort -V | tail -1)"
OUT="$HERE/out"

[ -n "$BT" ] || { echo "no build-tools under $SDK" >&2; exit 1; }
[ -n "$AJ" ] || { echo "no android.jar under $SDK" >&2; exit 1; }

cd "$HERE"
rm -rf "$OUT" && mkdir -p "$OUT/flat" "$OUT/classes" "$OUT/dex"

"$BT/aapt2" compile --dir res -o "$OUT/flat/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$AJ" --manifest AndroidManifest.xml \
  --java "$OUT" --min-sdk-version 24 --target-sdk-version 34 "$OUT/flat/res.zip"

javac -nowarn -source 8 -target 8 -bootclasspath "$AJ" -cp "$AJ" -d "$OUT/classes" \
  java/com/maestrodeck/a11ybad/MainActivity.java \
  "$OUT/com/maestrodeck/a11ybad/R.java" 2>/dev/null

find "$OUT/classes" -name '*.class' > "$OUT/classlist.txt"
"$BT/d8" --lib "$AJ" --output "$OUT/dex" "@$OUT/classlist.txt"

(cd "$OUT/dex" && zip -q "$OUT/base.apk" classes.dex)
"$BT/zipalign" -f 4 "$OUT/base.apk" "$OUT/aligned.apk"

# Reuses the sample app's demo key: it guards nothing, it only has to
# satisfy `adb install`.
KS="$HERE/../sample-app/demo.keystore"

"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --out "$OUT/a11y-bad-app.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify "$OUT/a11y-bad-app.apk"

rm -rf "$OUT/flat" "$OUT/classes" "$OUT/dex" "$OUT/com" "$OUT/base.apk" "$OUT/aligned.apk" "$OUT/classlist.txt"
echo "built: a11y-bad-app/out/a11y-bad-app.apk"
