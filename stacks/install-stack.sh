#!/usr/bin/env bash
set -euo pipefail

stack="${1:-}"
target="${2:-.}"

case "$stack" in
  hermes) file="SOUL.md"; src="$(dirname "$0")/hermes/SOUL.md" ;;
  codex) file="AGENTS.md"; src="$(dirname "$0")/codex/AGENTS.md" ;;
  claude) file="CLAUDE.md"; src="$(dirname "$0")/claude/CLAUDE.md" ;;
  opencode) file="AGENTS.md"; src="$(dirname "$0")/opencode/AGENTS.md" ;;
  *)
    echo "usage: $0 <hermes|codex|claude|opencode> [target]" >&2
    exit 1
    ;;
esac

if [[ ! -f "$src" ]]; then
  echo "missing stack file: $src" >&2
  exit 1
fi

mkdir -p "$target"
dest="$target/$file"
if [[ -f "$dest" ]]; then
  cp "$dest" "$dest.bak"
fi
cp "$src" "$dest"
echo "installed $stack -> $dest"
