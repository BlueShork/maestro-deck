#!/usr/bin/env bash
#
# Builds the onboarding sample app into ../src-tauri/resources/sample-app.apk.
#
# No Gradle on purpose: this is one activity and one layout, and a Gradle
# project would be more machinery than the app it builds. The SDK build-tools
# do the whole job — aapt2, javac, d8, zipalign, apksigner.
#
# Run this by hand after changing the app; the result is committed, because
# users have no Android SDK and cannot build it themselves. The app is not
# expected to change more than once in a blue moon.
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
  java/com/maestrodeck/sample/MainActivity.java \
  "$OUT/com/maestrodeck/sample/R.java" 2>/dev/null

find "$OUT/classes" -name '*.class' > "$OUT/classlist.txt"
"$BT/d8" --lib "$AJ" --output "$OUT/dex" "@$OUT/classlist.txt"

(cd "$OUT/dex" && zip -q "$OUT/base.apk" classes.dex)
"$BT/zipalign" -f 4 "$OUT/base.apk" "$OUT/aligned.apk"

# A fixed key, committed next to this script on purpose.
#
# Regenerating it per build — which this script used to do — gives every build
# a different signature, and Android then refuses to upgrade an install made by
# an earlier one (INSTALL_FAILED_UPDATE_INCOMPATIBLE). That would hit every user
# who had run the walkthrough before updating Maestro Deck.
#
# It guards nothing: this app is a demo fixture, never published, and the
# signature only has to satisfy `adb install`.
KS="$HERE/demo.keystore"

"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --out "$HERE/../src-tauri/resources/sample-app.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify "$HERE/../src-tauri/resources/sample-app.apk"

rm -rf "$OUT"
echo "built: src-tauri/resources/sample-app.apk"
