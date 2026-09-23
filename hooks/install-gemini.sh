#!/bin/bash
# =============================================================================
# AgentsLeak - Gemini CLI Installer Script
# =============================================================================
# Installs AgentsLeak hooks into Gemini CLI.
#
# What this script does:
# 1. Checks dependencies (jq, curl)
# 2. Creates ~/.agentsleak/hooks/ directories (reuses existing)
# 3. Copies common.sh + gemini-hook.sh to ~/.agentsleak/hooks/
# 4. Backs up existing settings.json if present
# 5. Merges hook configuration into Gemini CLI's settings.json
# 6. Creates ~/.agentsleak/config.env if not exists
#
# Gemini CLI's hooks config lives in settings.json (same "hooks" object shape
# as Claude Code's own settings.json), so this installer mirrors install.sh's
# merge approach rather than install-cursor.sh's flat hooks.json approach.
#
# NOTE: built from Gemini CLI's published hooks docs (geminicli.com/docs/hooks),
# not verified against a live install. Check the merged settings.json against
# your installed Gemini CLI version if hooks don't fire as expected.
#
# Usage:
#   ./install-gemini.sh [--unattended] [--project]
#
# Options:
#   --unattended    Skip confirmation prompts
#   --project       Install to .gemini/settings.json in cwd instead of global —
#                    scopes monitoring to sessions started in this folder only
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

AGENTSLEAK_VERSION="1.0.0"
INSTALL_DIR="${HOME}/.agentsleak"
HOOKS_DIR="${INSTALL_DIR}/hooks"

# Default to global install
GEMINI_SETTINGS_DIR="${HOME}/.gemini"
PROJECT_MODE=false
BACKUP_DIR="${INSTALL_DIR}/backups"

# Colors for output (if terminal supports it)
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    NC='\033[0m' # No Color
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    NC=''
fi

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------

info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $*"
}

error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

die() {
    error "$@"
    exit 1
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# -----------------------------------------------------------------------------
# Dependency Checks
# -----------------------------------------------------------------------------

check_dependencies() {
    local missing=()

    if ! command_exists jq; then
        missing+=("jq")
    fi

    if ! command_exists curl; then
        missing+=("curl")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        error "Missing required dependencies: ${missing[*]}"
        echo ""
        echo "Please install them first:"
        echo "  Ubuntu/Debian: sudo apt-get install ${missing[*]}"
        echo "  macOS:         brew install ${missing[*]}"
        echo "  Fedora:        sudo dnf install ${missing[*]}"
        exit 1
    fi

    success "All dependencies are installed"
}

# -----------------------------------------------------------------------------
# Installation Functions
# -----------------------------------------------------------------------------

get_script_dir() {
    local script_path="${BASH_SOURCE[0]}"
    while [[ -L "$script_path" ]]; do
        local dir=$(dirname "$script_path")
        script_path=$(readlink "$script_path")
        [[ "$script_path" != /* ]] && script_path="$dir/$script_path"
    done
    cd "$(dirname "$script_path")" && pwd
}

create_directories() {
    info "Creating installation directories..."

    mkdir -p "$HOOKS_DIR"
    mkdir -p "$BACKUP_DIR"
    mkdir -p "$GEMINI_SETTINGS_DIR"

    success "Directories created"
}

backup_settings() {
    if [[ -f "$GEMINI_SETTINGS_FILE" ]]; then
        local backup_file="${BACKUP_DIR}/gemini-settings.json.$(date +%Y%m%d_%H%M%S).bak"
        info "Backing up existing Gemini CLI settings to ${backup_file}..."
        cp "$GEMINI_SETTINGS_FILE" "$backup_file"
        success "Settings backed up"
    else
        info "No existing Gemini CLI settings found (will create new)"
    fi
}

copy_hook_scripts() {
    local source_dir
    source_dir=$(get_script_dir)

    info "Copying hook scripts to ${HOOKS_DIR}..."

    # Scripts needed for Gemini CLI support
    local scripts=(
        "common.sh"
        "gemini-hook.sh"
    )

    for script in "${scripts[@]}"; do
        local src="${source_dir}/${script}"
        local dst="${HOOKS_DIR}/${script}"

        if [[ -f "$src" ]]; then
            cp "$src" "$dst"
            chmod +x "$dst"
            info "  Installed: ${script}"
        else
            warn "  Missing source: ${script}"
        fi
    done

    success "Hook scripts installed"
}

configure_gemini() {
    info "Configuring Gemini CLI hooks..."

    # Create default settings if file doesn't exist
    if [[ ! -f "$GEMINI_SETTINGS_FILE" ]]; then
        echo '{}' > "$GEMINI_SETTINGS_FILE"
    fi

    # Validate existing JSON
    if ! jq empty "$GEMINI_SETTINGS_FILE" 2>/dev/null; then
        error "Existing settings.json is not valid JSON"
        error "Please fix or remove ${GEMINI_SETTINGS_FILE} and try again"
        exit 1
    fi

    local hook_cmd="${HOOKS_DIR}/gemini-hook.sh"

    # Hook configuration to merge — one adapter script handles every event.
    local hook_config
    hook_config=$(jq -n --arg cmd "$hook_cmd" '{
        hooks: {
            SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: $cmd, name: "agentsleak" }] }],
            SessionEnd: [{ matcher: "*", hooks: [{ type: "command", command: $cmd, name: "agentsleak" }] }],
            BeforeTool: [{ matcher: ".*", hooks: [{ type: "command", command: $cmd, name: "agentsleak" }] }],
            AfterTool: [{ matcher: ".*", hooks: [{ type: "command", command: $cmd, name: "agentsleak" }] }],
            BeforeAgent: [{ matcher: "*", hooks: [{ type: "command", command: $cmd, name: "agentsleak" }] }],
            PreCompress: [{ matcher: "*", hooks: [{ type: "command", command: $cmd, name: "agentsleak" }] }],
            Notification: [{ matcher: "*", hooks: [{ type: "command", command: $cmd, name: "agentsleak" }] }],
            AfterAgent: [{ matcher: "*", hooks: [{ type: "command", command: $cmd, name: "agentsleak" }] }]
        }
    }')

    # Merge hook configuration into existing settings, preserving anything else
    local merged
    merged=$(jq -s '.[0] * .[1]' "$GEMINI_SETTINGS_FILE" <(echo "$hook_config"))

    local tmpfile
    tmpfile=$(mktemp "${GEMINI_SETTINGS_FILE}.XXXXXX")
    echo "$merged" | jq '.' > "$tmpfile" && mv "$tmpfile" "$GEMINI_SETTINGS_FILE"

    success "Gemini CLI hooks configured: ${GEMINI_SETTINGS_FILE}"
}

create_config_file() {
    local config_file="${INSTALL_DIR}/config.env"

    if [[ -f "$config_file" ]]; then
        info "Configuration file already exists: ${config_file}"
        return 0
    fi

    info "Creating AgentsLeak configuration file..."

    cat > "$config_file" <<EOF
# AgentsLeak Configuration
# Edit these values to customize your installation

# Collector endpoint
AGENTSLEAK_HOST=localhost
AGENTSLEAK_PORT=3827

# Timeouts (in seconds)
AGENTSLEAK_SYNC_TIMEOUT=0.2
AGENTSLEAK_ASYNC_TIMEOUT=5

# Debug mode (set to 1 to enable debug logging)
AGENTSLEAK_DEBUG=0
EOF

    success "Configuration file created: ${config_file}"
}

print_success_message() {
    echo ""
    echo "============================================================"
    echo -e "${GREEN}AgentsLeak v${AGENTSLEAK_VERSION} installed for Gemini CLI!${NC}"
    echo "============================================================"
    echo ""
    echo "Installation Summary:"
    echo "  - Hook scripts: ${HOOKS_DIR}"
    echo "  - Gemini CLI settings: ${GEMINI_SETTINGS_FILE}"
    echo "  - Configuration: ${INSTALL_DIR}/config.env"
    echo "  - Backups: ${BACKUP_DIR}"
    echo ""
    echo "Next Steps:"
    echo "  1. Start the AgentsLeak server:"
    echo "     agentsleak"
    echo ""
    if [[ "$PROJECT_MODE" == "true" ]]; then
        echo "  2. Use Gemini CLI in $(pwd) - only sessions started in this"
        echo "     folder will be monitored and logged."
    else
        echo "  2. Use Gemini CLI normally - all tool usage will be"
        echo "     monitored and logged."
    fi
    echo ""
    echo "  3. View logs and alerts in the AgentsLeak dashboard:"
    echo "     http://localhost:3827"
    echo ""
    echo "Configuration:"
    echo "  Edit ${INSTALL_DIR}/config.env to customize settings."
    echo "  Or set environment variables: AGENTSLEAK_HOST, AGENTSLEAK_PORT"
    echo ""
    echo "To uninstall:"
    echo "  ./uninstall-gemini.sh"
    echo ""
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

main() {
    local unattended=false

    # Parse arguments
    for arg in "$@"; do
        case $arg in
            --unattended)
                unattended=true
                ;;
            --project)
                PROJECT_MODE=true
                GEMINI_SETTINGS_DIR="$(pwd)/.gemini"
                ;;
            --help|-h)
                echo "Usage: $0 [--unattended] [--project]"
                echo ""
                echo "Install AgentsLeak hooks for Gemini CLI."
                echo ""
                echo "Options:"
                echo "  --unattended    Skip confirmation prompts"
                echo "  --project       Install to .gemini/settings.json in current directory"
                echo "  --help, -h      Show this help message"
                exit 0
                ;;
            *)
                die "Unknown option: $arg"
                ;;
        esac
    done

    GEMINI_SETTINGS_FILE="${GEMINI_SETTINGS_DIR}/settings.json"

    echo ""
    echo "============================================================"
    echo "  AgentsLeak Gemini CLI Installer v${AGENTSLEAK_VERSION}"
    echo "  AI Agent Security Monitoring"
    echo "============================================================"
    echo ""

    if [[ "$PROJECT_MODE" == "true" ]]; then
        info "Project mode: installing to $(pwd)/.gemini/settings.json"
    else
        info "Global mode: installing to ~/.gemini/settings.json"
    fi
    echo ""

    # Confirmation prompt
    if [[ "$unattended" != "true" ]]; then
        echo "This will install AgentsLeak hooks into Gemini CLI."
        echo "Your existing Gemini CLI settings will be backed up."
        echo ""
        read -p "Continue with installation? [y/N] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Installation cancelled."
            exit 0
        fi
        echo ""
    fi

    # Run installation steps
    check_dependencies
    create_directories
    backup_settings
    copy_hook_scripts
    configure_gemini
    create_config_file
    print_success_message
}

main "$@"
