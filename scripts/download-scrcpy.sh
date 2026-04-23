#!/bin/sh
# Download the bundled scrcpy server jar used by Maestro Deck for Android
# screen mirroring. Idempotent: if the destination file already exists with
# the expected SHA-256, the script is a no-op.
#
# Pinned to scrcpy v2.7 — bumping this version requires regenerating the
# expected SHA-256 below. See docs/PLAN.md §7 (Risk 2).

set -eu

SCRCPY_VERSION="2.7"
SCRCPY_FILENAME="scrcpy-server-v${SCRCPY_VERSION}"
SCRCPY_URL="https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/${SCRCPY_FILENAME}"
EXPECTED_SHA256="a23c5659f36c260f105c022d27bcb3eafffa26070e7baa9eda66d01377a1adba"

# Resolve repo root from the script location so the script can be invoked
# from anywhere (CI, dev shell, IDE task).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RESOURCES_DIR="${REPO_ROOT}/src-tauri/resources"
DEST_FILE="${RESOURCES_DIR}/${SCRCPY_FILENAME}.jar"

mkdir -p "${RESOURCES_DIR}"

# Compute SHA-256 using whichever tool is available on the host
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "error: no sha256sum or shasum tool available" >&2
    exit 1
  fi
}

if [ -f "${DEST_FILE}" ]; then
  ACTUAL_SHA256="$(sha256_of "${DEST_FILE}")"
  if [ "${ACTUAL_SHA256}" = "${EXPECTED_SHA256}" ]; then
    echo "scrcpy server v${SCRCPY_VERSION} already present and verified."
    exit 0
  else
    echo "warning: existing ${DEST_FILE} has mismatching SHA-256, redownloading." >&2
    rm -f "${DEST_FILE}"
  fi
fi

# Pick a downloader. curl is preferred; wget is a common fallback.
TMP_FILE="${DEST_FILE}.tmp"
if command -v curl >/dev/null 2>&1; then
  echo "Downloading ${SCRCPY_URL} via curl..."
  curl -fSL --retry 3 --retry-delay 2 -o "${TMP_FILE}" "${SCRCPY_URL}"
elif command -v wget >/dev/null 2>&1; then
  echo "Downloading ${SCRCPY_URL} via wget..."
  wget -q -O "${TMP_FILE}" "${SCRCPY_URL}"
else
  echo "error: neither curl nor wget is available" >&2
  exit 1
fi

ACTUAL_SHA256="$(sha256_of "${TMP_FILE}")"
if [ "${ACTUAL_SHA256}" != "${EXPECTED_SHA256}" ]; then
  echo "error: SHA-256 mismatch for ${SCRCPY_FILENAME}" >&2
  echo "  expected: ${EXPECTED_SHA256}" >&2
  echo "  actual:   ${ACTUAL_SHA256}" >&2
  rm -f "${TMP_FILE}"
  exit 1
fi

mv "${TMP_FILE}" "${DEST_FILE}"
echo "scrcpy server v${SCRCPY_VERSION} downloaded to ${DEST_FILE}"
