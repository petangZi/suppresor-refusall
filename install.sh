#!/usr/bin/env bash
# Suppresor Refusall by Redz — Automated Installer
# Run: curl -fsSL https://raw.githubusercontent.com/redz/suppresor-refusall/main/install.sh | bash
# Or:  bash install.sh --local (when run from extracted package)

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Config
REPO="redz/suppresor-refusall"
BRANCH="main"
PLUGIN_DIR="$HOME/.config/opencode/plugins/suppresor-refusall"
COMMANDS_DIR="$HOME/.config/opencode/commands"
SKILLS_DIR="$HOME/.config/opencode/skills/suppresor-refusall"
CONFIG_FILE="$HOME/.config/opencode/opencode.jsonc"

# Files to install
FILES=(
  "plugin.js"
  "package.json"
  "suppresor-refusall.md"
  "SKILL.md"
  "README.md"
  "GUIDE.md"
  "LICENSE"
  "CHANGELOG.md"
)

RAW_BASE="https://raw.githubusercontent.com/$REPO/$BRANCH"
LOCAL_MODE=false

# Parse args
for arg in "$@"; do
  case $arg in
    --local) LOCAL_MODE=true ;;
    --help|-h)
      echo "Usage: $0 [--local]"
      echo "  --local  Install from current directory (extracted package)"
      exit 0
      ;;
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
  for cmd in curl jq node; do
    if ! command -v "$cmd" &> /dev/null; then
      error "$cmd is required but not installed"
    fi
  done
  success "All dependencies found"
}

create_dirs() {
  log "Creating directories..."
  mkdir -p "$PLUGIN_DIR" "$COMMANDS_DIR" "$SKILLS_DIR"
  success "Directories created"
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
      if curl -fsSL "$url" -o "$dest"; then
        success "Downloaded $file"
      else
        error "Failed to download $file from $url"
      fi
    done
  fi
}

update_config() {
  log "Updating opencode config..."
  
  if [[ ! -f "$CONFIG_FILE" ]]; then
    warn "Config file not found, creating minimal config"
    echo '{"$schema":"https://opencode.ai/config.json","plugin":[]}' > "$CONFIG_FILE"
  fi

  if grep -q "suppresor-refusall/plugin.js" "$CONFIG_FILE"; then
    warn "Plugin already registered in config"
  else
    local plugin_path="./plugins/suppresor-refusall/plugin.js"
    jq --arg plugin "$plugin_path" '
      .plugin += [$plugin] | .plugin |= unique
    ' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
    success "Plugin registered in opencode.jsonc"
  fi
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
  echo "  /suppresor-refusall on|off|status"
  echo "  /suppresor-refusall theme <name>"
  echo "  /suppresor-refusall genius on|off"
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
  create_dirs
  download_files
  update_config
  verify
  print_next_steps
}

main "$@"
