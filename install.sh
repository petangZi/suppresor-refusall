#!/usr/bin/env bash
# Suppresor Refusall by Redz — Unix bootstrap.
# The real installer is install.mjs so Windows, macOS, Linux, and Termux share
# one code path.
#
#   curl -fsSL https://raw.githubusercontent.com/petangZi/suppresor-refusall/main/install.sh | bash -s -- --key TTK-XXXX-XXXX-XXXX
#   bash install.sh --local --key TTK-XXXX-XXXX-XXXX

set -euo pipefail

REPO="petangZi/suppresor-refusall"
BRANCH="main"
LOCAL_MODE=false
ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) LOCAL_MODE=true; shift ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "[✗] Node.js 18+ is required. Install Node.js first: https://nodejs.org" >&2
  exit 1
fi

SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [[ "$LOCAL_MODE" == "true" && -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/install.mjs" ]]; then
  node "$SCRIPT_DIR/install.mjs" --local --repo "$REPO" --branch "$BRANCH" ${ARGS[@]+"${ARGS[@]}"}
  exit $?
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/suppresor-refusall.XXXXXX")"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

URL="https://raw.githubusercontent.com/$REPO/$BRANCH/install.mjs"
if ! command -v curl >/dev/null 2>&1; then
  echo "[✗] curl is required to bootstrap the installer." >&2
  exit 1
fi
curl -fsSL "$URL" -o "$TMP_DIR/install.mjs"
node "$TMP_DIR/install.mjs" --repo "$REPO" --branch "$BRANCH" ${ARGS[@]+"${ARGS[@]}"}