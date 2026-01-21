#!/bin/bash
# =============================================================================
# AgentsLeak - Cursor Installer Script
# =============================================================================
# Installs AgentsLeak hooks into Cursor (v1.7+).
#
# What this script does:
# 1. Checks dependencies (jq, curl)
# 2. Creates ~/.agentsleak/hooks/ directories (reuses existing)
# 3. Copies common.sh + cursor-hook.sh to ~/.agentsleak/hooks/
# 4. Backs up existing ~/.cursor/hooks.json if present
# 5. Writes ~/.cursor/hooks.json with all 6 events
# 6. Creates ~/.agentsleak/config.env if not exists
#
# Usage:
#   ./install-cursor.sh [--unattended] [--project]
#
# Options:
#   --unattended    Skip confirmation prompts
#   --project       Install to .cursor/hooks.json in cwd instead of global
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

AGENTSLEAK_VERSION="1.0.0"
INSTALL_DIR="${HOME}/.agentsleak"
HOOKS_DIR="${INSTALL_DIR}/hooks"
BACKUP_DIR="${INSTALL_DIR}/backups"

# Default to global install
CURSOR_DIR="${HOME}/.cursor"
PROJECT_MODE=false

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
    mkdir -p "$CURSOR_DIR"

    success "Directories created"
}

backup_cursor_hooks() {
    local hooks_file="${CURSOR_DIR}/hooks.json"

    if [[ -f "$hooks_file" ]]; then
        local backup_file="${BACKUP_DIR}/cursor-hooks.json.$(date +%Y%m%d_%H%M%S).bak"
        info "Backing up existing Cursor hooks to ${backup_file}..."
        cp "$hooks_file" "$backup_file"
        success "Cursor hooks backed up"
    else
        info "No existing Cursor hooks found (will create new)"
    fi
}

copy_hook_scripts() {
    local source_dir
    source_dir=$(get_script_dir)

    info "Copying hook scripts to ${HOOKS_DIR}..."

    # Scripts needed for Cursor support
    local scripts=(
        "common.sh"
        "cursor-hook.sh"
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

configure_cursor() {
    local hooks_file="${CURSOR_DIR}/hooks.json"
    local hook_command="${HOOKS_DIR}/cursor-hook.sh"

    info "Configuring Cursor hooks..."

    # Build the hooks.json config — 9 events per official Cursor hooks API
    local hook_config
    hook_config=$(jq -n --arg cmd "$hook_command" '{
        version: 1,
        hooks: {
            sessionStart: [{ command: $cmd }],
            sessionEnd: [{ command: $cmd }],
            preToolUse: [{ command: $cmd }],
            postToolUse: [{ command: $cmd }],
            postToolUseFailure: [{ command: $cmd }],
            subagentStart: [{ command: $cmd }],
            subagentStop: [{ command: $cmd }],
            beforeSubmitPrompt: [{ command: $cmd }],
            stop: [{ command: $cmd }]
        }
    }')

    if [[ -f "$hooks_file" ]]; then
        # First, remove any existing AgentsLeak entries to prevent duplicates on upgrade
        local cleaned
        cleaned=$(jq --arg cmd "$hook_command" '
            if .hooks then
                .hooks |= with_entries(
                    .value |= map(select(.command != $cmd))
                ) |
                .hooks |= with_entries(select(.value | length > 0))
            else . end
        ' "$hooks_file" 2>/dev/null)
        if [[ -n "$cleaned" ]]; then
            echo "$cleaned" > "$hooks_file"
        fi

        # Merge with existing hooks.json — add our hooks without removing others
        # For each event type, append our hook entry if not already present
        local merged
        merged=$(jq -s --arg cmd "$hook_command" '
            .[0] as $existing | .[1] as $new |
            ($existing // {}) * {
                version: ($existing.version // $new.version),
                hooks: (
                    ($existing.hooks // {}) as $eh |
                    ($new.hooks // {}) as $nh |
                    ($eh | keys) + ($nh | keys) | unique | map(
                        . as $key |
                        ($eh[$key] // []) as $existing_hooks |
                        ($nh[$key] // []) as $new_hooks |
                        # Only add our hook if not already present
                        if ($existing_hooks | map(select(.command == $cmd)) | length) > 0
                        then { ($key): $existing_hooks }
                        else { ($key): ($existing_hooks + $new_hooks) }
                        end
                    ) | add
                )
            }
        ' "$hooks_file" <(echo "$hook_config"))

        local tmpfile
        tmpfile=$(mktemp "${hooks_file}.XXXXXX")
        echo "$merged" | jq '.' > "$tmpfile" && mv "$tmpfile" "$hooks_file"
    else
        local tmpfile
        tmpfile=$(mktemp "${hooks_file}.XXXXXX")
        echo "$hook_config" | jq '.' > "$tmpfile" && mv "$tmpfile" "$hooks_file"
    fi

    success "Cursor hooks configured: ${hooks_file}"
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
    local hooks_file="${CURSOR_DIR}/hooks.json"

    echo ""
    echo "============================================================"
    echo -e "${GREEN}AgentsLeak v${AGENTSLEAK_VERSION} installed for Cursor!${NC}"
    echo "============================================================"
    echo ""
    echo "Installation Summary:"
    echo "  - Hook scripts: ${HOOKS_DIR}"
    echo "  - Cursor hooks: ${hooks_file}"
    echo "  - Configuration: ${INSTALL_DIR}/config.env"
    echo "  - Backups: ${BACKUP_DIR}"
    echo ""
    echo "Next Steps:"
    echo "  1. Start the AgentsLeak collector server:"
    echo "     agentsleak-server start"
    echo ""
    echo "  2. Use Cursor normally - all tool usage will be"
    echo "     monitored and logged."
    echo ""
    echo "  3. View logs and alerts in the AgentsLeak dashboard:"
    echo "     http://localhost:3827"
    echo ""
    echo "Configuration:"
    echo "  Edit ${INSTALL_DIR}/config.env to customize settings."
    echo "  Or set environment variables: AGENTSLEAK_HOST, AGENTSLEAK_PORT"
    echo ""
    echo "To uninstall:"
    echo "  ./uninstall-cursor.sh"
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
                CURSOR_DIR="$(pwd)/.cursor"
                ;;
            --help|-h)
                echo "Usage: $0 [--unattended] [--project]"
                echo ""
                echo "Install AgentsLeak hooks for Cursor."
                echo ""
                echo "Options:"
                echo "  --unattended    Skip confirmation prompts"
                echo "  --project       Install to .cursor/hooks.json in current directory"
                echo "  --help, -h      Show this help message"
                exit 0
                ;;
            *)
                die "Unknown option: $arg"
                ;;
        esac
    done

    echo ""
    echo "============================================================"
    echo "  AgentsLeak Cursor Installer v${AGENTSLEAK_VERSION}"
    echo "  AI Agent Security Monitoring"
    echo "============================================================"
    echo ""

    if [[ "$PROJECT_MODE" == "true" ]]; then
        info "Project mode: installing to $(pwd)/.cursor/hooks.json"
    else
        info "Global mode: installing to ~/.cursor/hooks.json"
    fi
    echo ""

    # Confirmation prompt
    if [[ "$unattended" != "true" ]]; then
        echo "This will install AgentsLeak hooks into Cursor."
        echo "Your existing Cursor hooks will be backed up."
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
    backup_cursor_hooks
    copy_hook_scripts
    configure_cursor
    create_config_file
    print_success_message
}

main "$@"
