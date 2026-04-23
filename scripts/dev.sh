#!/bin/sh
# One-shot developer entry point: ensure the scrcpy server jar is present,
# then start Tauri in dev mode.
#
# Usage: ./scripts/dev.sh

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

# Make sure the bundled scrcpy server is present and verified before launching
# Tauri (otherwise the native side panics at runtime when it tries to push it
# to the device).
sh "${SCRIPT_DIR}/download-scrcpy.sh"

# Hand off to pnpm for the actual dev server.
exec pnpm tauri:dev
