#!/usr/bin/env bash
# Suppresor Refusall by Redz — Automated Installer
# Run: SUPPRESOR_LICENSE_KEY='TTK-XXXX-XXXX-XXXX' bash -c "$(curl -fsSL https://raw.githubusercontent.com/petangZi/suppresor-refusall/main/install.sh)"
# Or:  curl -fsSL .../install.sh | bash -s -- --key 'TTK-XXXX-XXXX-XXXX'
# Local: bash install.sh --local --key 'TTK-XXXX-XXXX-XXXX'

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Config
REPO="petangZi/suppresor-refusall"
BRANCH="main"
CONFIG_ROOT="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
PLUGIN_DIR="$CONFIG_ROOT/plugins/suppresor-refusall"
COMMANDS_DIR="$CONFIG_ROOT/commands"
SKILLS_DIR="$CONFIG_ROOT/skills/suppresor-refusall"
THEMES_DIR="$CONFIG_ROOT/themes"
CONFIG_FILE="$CONFIG_ROOT/opencode.jsonc"
KEY_FILE="$CONFIG_ROOT/.suppresor-key"
KEY_REQUIRED_FILE="$CONFIG_ROOT/.suppresor-key-required"
LICENSE_KEY="${SUPPRESOR_LICENSE_KEY:-}"

# Files to install
FILES=(
  "plugin.js"
  "mcp-server.mjs"
  "refusal-patterns.mjs"
  "project-config.mjs"
  "intent-recovery.mjs"
  "DOMAIN.md"
  "stacks/README.md"
  "stacks/hermes/SOUL.md"
  "stacks/codex/AGENTS.md"
  "stacks/claude/CLAUDE.md"
  "stacks/opencode/AGENTS.md"
  "stacks/install-stack.sh"
  "stacks/install-stack.ps1"
  "scripts/update-config.mjs"
  "tiki-agent.mjs"
  "tiki-idle.mjs"
  "agent-tiki.md"
  "license.mjs"
  "license-key.mjs"
  "gate-client.mjs"
  "firestore-client.js"
  "firestore.rules"
  "firestore-access.json"
  "package.json"
  "suppresor-refusall.md"
  "SKILL.md"
  "README.md"
  "GUIDE.md"
  "LICENSE"
  "CHANGELOG.md"
)

# Files installed into plugin subdirs
SUBDIR_FILES=(
  "themes/suppresor-red.json"
  "server/gate.mjs"
  "server/token-key-public.pem"
  "server/license-public.pem"
)

RAW_BASE="https://raw.githubusercontent.com/$REPO/$BRANCH"
LOCAL_MODE=false

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) LOCAL_MODE=true; shift ;;
    --key) LICENSE_KEY="${2:-}"; shift 2 ;;
    --key=*) LICENSE_KEY="${1#--key=}"; shift ;;
    --help|-h)
      echo "Usage: $0 [--local] [--key <TTK-XXXX-XXXX-XXXX>]"
      echo "  --local  Install from current directory (extracted package)"
      echo "  --key    License key; required for install"
      echo "  curl ... | bash -s -- --key TTK-XXXX-XXXX-XXXX"
      exit 0
      ;;
    *) shift ;;
  esac
done

log() {
  echo -e "${BLUE}[suppresor-refusall]${NC} $1"
}

success() {
  echo -e "${GREEN}[✓]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[!]${NC} $1"
}

error() {
  echo -e "${RED}[✗]${NC} $1"
  exit 1
}

check_deps() {
  log "Checking dependencies..."
  for cmd in curl node; do
    if ! command -v "$cmd" &> /dev/null; then
      error "$cmd is required but not installed"
    fi
  done
  success "All dependencies found"
}

collect_key() {
  if [[ -n "$LICENSE_KEY" ]]; then
    return
  fi
  if [[ -t 0 ]]; then
    read -rsp "License key (TTK-...): " LICENSE_KEY
    echo ""
  fi
  if [[ -z "$LICENSE_KEY" ]]; then
    error "License key required. Set SUPPRESOR_LICENSE_KEY or pass --key."
  fi
}

verify_license_key() {
  if [[ ! -f "$PLUGIN_DIR/license-key.mjs" ]]; then
    error "Read-only license verifier missing"
  fi
  if ! node "$PLUGIN_DIR/license-key.mjs" --verify "$LICENSE_KEY" >/dev/null 2>&1; then
    error "License key invalid, expired, atau tidak ditemukan di Firestore accessKeys"
  fi
  success "License key verified"
}

persist_license_key() {
  mkdir -p "$(dirname "$KEY_FILE")"
  umask 077
  printf '%s' "$LICENSE_KEY" > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  : > "$KEY_REQUIRED_FILE"
  success "License key stored at $KEY_FILE"
}

create_dirs() {
  log "Creating directories..."
  mkdir -p "$PLUGIN_DIR" "$COMMANDS_DIR" "$SKILLS_DIR" "$THEMES_DIR"
  success "Directories created"
}

# Files installed into plugin subdirs
install_subdir_files() {
  local base="$1"
  for file in "${SUBDIR_FILES[@]}"; do
    local src="$base/$file"
    local dest="$PLUGIN_DIR/$file"
    mkdir -p "$(dirname "$dest")"
    if [[ "$LOCAL_MODE" == "true" ]]; then
      if [[ -f "$src" ]]; then
        cp "$src" "$dest"
        success "Installed $file"
      else
        warn "Source file not found: $file (skipping)"
      fi
    else
      if curl -fsSL "$RAW_BASE/$file" -o "$dest"; then
        success "Downloaded $file"
      else
        error "Failed to download $file from $RAW_BASE/$file"
      fi
    fi
    if [[ "$file" == themes/* ]]; then
      cp "$dest" "$THEMES_DIR/$(basename "$file")"
      success "Installed theme $(basename "$file") -> $THEMES_DIR/"
    fi
  done
}

download_files() {
  if [[ "$LOCAL_MODE" == "true" ]]; then
    log "Installing from local package..."
    for file in "${FILES[@]}"; do
      local src="$PWD/$file"
      local dest="$PLUGIN_DIR/$file"
      if [[ "$file" == "suppresor-refusall.md" ]]; then
        dest="$COMMANDS_DIR/$file"
      elif [[ "$file" == "SKILL.md" ]]; then
        dest="$SKILLS_DIR/$file"
      fi
      mkdir -p "$(dirname "$dest")"
      if [[ -f "$src" ]]; then
        cp "$src" "$dest"
        success "Installed $file"
      else
        warn "Source file not found: $file (skipping)"
      fi
    done
  else
    log "Downloading files from $REPO@$BRANCH..."
    for file in "${FILES[@]}"; do
      local url="$RAW_BASE/$file"
      local dest="$PLUGIN_DIR/$file"
      if [[ "$file" == "suppresor-refusall.md" ]]; then
        dest="$COMMANDS_DIR/$file"
      elif [[ "$file" == "SKILL.md" ]]; then
        dest="$SKILLS_DIR/$file"
      fi
      mkdir -p "$(dirname "$dest")"
      if curl -fsSL "$url" -o "$dest"; then
        success "Downloaded $file"
      else
        error "Failed to download $file from $url"
      fi
    done
  fi
  install_subdir_files "$([[ "$LOCAL_MODE" == "true" ]] && echo "$PWD" || echo "")"
}

update_config() {
  log "Updating opencode config..."
  mkdir -p "$(dirname "$CONFIG_FILE")"
  node "$PLUGIN_DIR/scripts/update-config.mjs" \
    --config "$CONFIG_FILE" \
    --plugin "./plugins/suppresor-refusall/plugin.js" \
    --mcp "$PLUGIN_DIR/mcp-server.mjs" \
    --theme "suppresor-red"
  success "Plugin, theme, and MCP registered in opencode.jsonc"
}

verify() {
  log "Verifying installation..."
  
  if [[ ! -f "$PLUGIN_DIR/plugin.js" ]]; then
    error "Plugin file missing"
  fi
  
  if ! node --check "$PLUGIN_DIR/plugin.js" 2>/dev/null; then
    error "Plugin syntax check failed"
  fi
  
  if ! grep -q "suppresor-refusall/plugin.js" "$CONFIG_FILE"; then
    error "Plugin not found in config"
  fi
  
  if [[ ! -f "$COMMANDS_DIR/suppresor-refusall.md" ]]; then
    error "Command file missing"
  fi
  
  if [[ ! -f "$SKILLS_DIR/SKILL.md" ]]; then
    error "Skill file missing"
  fi

  if [[ ! -f "$PLUGIN_DIR/license.mjs" ]]; then
    error "License gate file missing"
  fi

  if [[ ! -f "$PLUGIN_DIR/project-config.mjs" ]]; then
    error "Project config loader missing"
  fi

  if ! node --check "$PLUGIN_DIR/project-config.mjs" 2>/dev/null; then
    error "Project config loader syntax check failed"
  fi

  if [[ ! -f "$PLUGIN_DIR/intent-recovery.mjs" ]]; then
    error "Intent recovery module missing"
  fi

  if [[ ! -f "$PLUGIN_DIR/DOMAIN.md" ]]; then
    error "Domain index missing"
  fi

  if [[ ! -f "$PLUGIN_DIR/scripts/update-config.mjs" ]]; then
    error "Config updater missing"
  fi

  if ! node --check "$PLUGIN_DIR/scripts/update-config.mjs" 2>/dev/null; then
    error "Config updater syntax check failed"
  fi

  if [[ ! -f "$PLUGIN_DIR/firestore-access.json" ]]; then
    error "Firestore access config missing"
  fi

  if ! node --check "$PLUGIN_DIR/license.mjs" 2>/dev/null; then
    error "License gate syntax check failed"
  fi

  if [[ ! -f "$PLUGIN_DIR/license-key.mjs" ]]; then
    error "Read-only license verifier missing"
  fi

  if ! node --check "$PLUGIN_DIR/license-key.mjs" 2>/dev/null; then
    error "Read-only license verifier syntax check failed"
  fi

  if [[ ! -f "$KEY_FILE" ]]; then
    error "License key file missing"
  fi

  if [[ ! -f "$KEY_REQUIRED_FILE" ]]; then
    error "License key requirement marker missing"
  fi

  if [[ ! -f "$PLUGIN_DIR/mcp-server.mjs" ]]; then
    error "MCP server file missing"
  fi

  if [[ ! -f "$THEMES_DIR/suppresor-red.json" ]]; then
    error "Theme file missing"
  fi

  if ! node --check "$PLUGIN_DIR/mcp-server.mjs" 2>/dev/null; then
    error "MCP server syntax check failed"
  fi

  success "All checks passed"
}

print_next_steps() {
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Suppresor Refusall installed successfully!${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Restart opencode:  ${YELLOW}opencode${NC}"
  echo "  2. Verify status:     ${YELLOW}/suppresor-refusall status${NC}"
  echo "  3. Enable genius:     ${YELLOW}/suppresor-refusall genius on${NC}"
  echo ""
  echo "Commands available in opencode menu:"
  echo "  /suppresor-refusall on|off|status|intercepts"
  echo "  /suppresor-refusall theme <name>"
  echo "  /suppresor-refusall genius on|off"
  echo ""
  echo "License: read-only key gate. Installer key: $KEY_FILE"
  echo "Invalid/missing key blocks the plugin. No runtime writes."
  echo ""
  echo "MCP tools:"
  echo "  suppresor_status | suppresor_toggle | suppresor_theme"
  echo "  suppresor_intercepts | suppresor_learned | suppresor_watermark | suppresor_config"
  echo ""
  echo "Natural language:"
  echo "  \"suppresor refusall nyala\"   # ON"
  echo "  \"suppresor refusall mati\"    # OFF"
  echo "  \"genGenius nyala\"            # Genius ON"
  echo ""
  echo "Files installed:"
  echo "  $PLUGIN_DIR/"
  echo "  $COMMANDS_DIR/suppresor-refusall.md"
  echo "  $SKILLS_DIR/SKILL.md"
  echo "  $THEMES_DIR/suppresor-red.json"
  echo ""
  echo -e "${BLUE}Happy coding — no refusal, full power!${NC}"
}

main() {
  echo -e "${RED}"
  echo "  ███████╗███████╗████████╗██╗   ██╗██████╗ ███████╗"
  echo "  ██╔════╝██╔════╝╚══██╔══╝██║   ██║██╔══██╗██╔════╝"
  echo "  ███████╗█████╗     ██║   ██║   ██║██████╔╝█████╗  "
  echo "  ╚════██║██╔══╝     ██║   ██║   ██║██╔══██╗██╔══╝  "
  echo "  ███████║███████╗   ██║   ╚██████╔╝██║  ██║███████╗"
  echo "  ╚══════╝╚══════╝   ██═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝"
  echo -e "${NC}"
  echo "  Suppresor Refusall by Redz — Obliteratoratus Grade"
  echo ""
  
  check_deps
  collect_key
  create_dirs
  download_files
  verify_license_key
  persist_license_key
  update_config
  verify
  print_next_steps
}

main "$@"
