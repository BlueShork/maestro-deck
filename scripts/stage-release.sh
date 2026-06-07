#!/usr/bin/env bash
# Assemble the macOS release artifacts + latest.json for v0.4.0 into
# release-artifacts/<version>/, ready to attach to the GitHub release tag.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="0.4.0"
TAG="v${VERSION}"
REPO="BlueShork/maestro-deck"
BUNDLE="src-tauri/target/release/bundle"
STAGE="release-artifacts/${VERSION}"

mkdir -p "$STAGE"

# DMG (notarized + stapled) under the GitHub-style asset name
cp "$BUNDLE/dmg/Maestro Deck_${VERSION}_aarch64.dmg" "$STAGE/"

# Updater bundle + signature, versioned for the release
cp "$BUNDLE/macos/Maestro Deck.app.tar.gz"     "$STAGE/Maestro Deck_${VERSION}_aarch64.app.tar.gz"
cp "$BUNDLE/macos/Maestro Deck.app.tar.gz.sig" "$STAGE/Maestro Deck_${VERSION}_aarch64.app.tar.gz.sig"

MAC_SIG=$(cat "$BUNDLE/macos/Maestro Deck.app.tar.gz.sig")
MAC_URL="https://github.com/${REPO}/releases/download/${TAG}/Maestro%20Deck_${VERSION}_aarch64.app.tar.gz"
PUBDATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Release notes = the v0.4.0 section of the changelog
NOTES=$(awk '/^# What.s New in v0\.4\.0/{f=1;next} /^# What.s New in v0\.3\.2/{f=0} f' CHANGELOG_EN.md)

jq -n \
  --arg version "$VERSION" \
  --arg notes "$NOTES" \
  --arg pubdate "$PUBDATE" \
  --arg mac_sig "$MAC_SIG" \
  --arg mac_url "$MAC_URL" \
  '{
     version: $version,
     notes: $notes,
     pub_date: $pubdate,
     platforms: {
       "darwin-aarch64": { signature: $mac_sig, url: $mac_url }
     }
   }' > "$STAGE/latest.json"

echo "Staged release artifacts in $STAGE:"
ls -la "$STAGE"
