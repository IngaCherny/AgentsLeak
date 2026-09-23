#!/bin/bash
# =============================================================================
# AgentsLeak - Windsurf (Cascade) Installer Script
# =============================================================================
# Installs AgentsLeak hooks into Windsurf / Devin Desktop's Cascade agent.
#
# What this script does:
# 1. Checks dependencies (jq, curl)
# 2. Creates ~/.agentsleak/hooks/ directories (reuses existing)
# 3. Copies common.sh + windsurf-hook.sh to ~/.agentsleak/hooks/
# 4. Backs up existing hooks.json if present
# 5. Writes/merges Cascade's hooks.json with all wired events
# 6. Creates ~/.agentsleak/config.env if not exists
#
# Cascade's hooks.json schema is flat — no matcher/type nesting, just
# {"command": "..."} entries per event — so this installer mirrors
# install-cursor.sh's merge approach rather than install.sh's.
#
# Windsurf was folded into Cognition's "Devin Desktop" product; both names
# and hooks.json locations are still recognized. This installer targets the
# paths still labeled "Windsurf" (~/.codeium/windsurf/hooks.json globally,
# .windsurf/hooks.json per-project) since that's what a "Windsurf" install
# actually has on disk today; Devin Desktop's newer .devin/hooks.json path
# is checked by Cascade only when the Windsurf path is absent, so this still
# works there too.
#
# NOTE: built from Cascade's published hooks docs, not verified against a
# live install. See hooks/windsurf-hook.sh's header for the exit-code-based
# blocking protocol this integration relies on.
#
# Usage:
#   ./install-windsurf.sh [--unattended] [--project]
#
# Options:
#   --unattended    Skip confirmation prompts
#   --project       Install to .windsurf/hooks.json in cwd instead of global
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
WINDSURF_DIR="${HOME}/.codeium/windsurf"
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
    mkdir -p "$WINDSURF_DIR"

    success "Directories created"
}

backup_hooks() {
    local hooks_file="${WINDSURF_DIR}/hooks.json"

    if [[ -f "$hooks_file" ]]; then
        local backup_file="${BACKUP_DIR}/windsurf-hooks.json.$(date +%Y%m%d_%H%M%S).bak"
        info "Backing up existing Windsurf hooks to ${backup_file}..."
        cp "$hooks_file" "$backup_file"
        success "Windsurf hooks backed up"
    else
        info "No existing Windsurf hooks found (will create new)"
    fi
}

copy_hook_scripts() {
    local source_dir
    source_dir=$(get_script_dir)

    info "Copying hook scripts to ${HOOKS_DIR}..."

    local scripts=(
        "common.sh"
        "windsurf-hook.sh"
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

configure_windsurf() {
    local hooks_file="${WINDSURF_DIR}/hooks.json"
    local hook_command="${HOOKS_DIR}/windsurf-hook.sh"

    info "Configuring Windsurf Cascade hooks..."

    # Build the hooks.json config — flat schema, one adapter script per event
    local hook_config
    hook_config=$(jq -n --arg cmd "$hook_command" '{
        hooks: {
            pre_read_code: [{ command: $cmd }],
            pre_write_code: [{ command: $cmd }],
            pre_run_command: [{ command: $cmd }],
            pre_mcp_tool_use: [{ command: $cmd }],
            pre_user_prompt: [{ command: $cmd }],
            post_read_code: [{ command: $cmd }],
            post_write_code: [{ command: $cmd }],
            post_run_command: [{ command: $cmd }],
            post_mcp_tool_use: [{ command: $cmd }]
        }
    }')

    if [[ -f "$hooks_file" ]]; then
        # Remove any existing AgentsLeak entries first to prevent duplicates on upgrade
        local cleaned
        cleaned=$(jq --arg cmd "$hook_command" '
            if .hooks then
                .hooks |= with_entries(.value |= map(select(.command != $cmd))) |
                .hooks |= with_entries(select(.value | length > 0))
            else . end
        ' "$hooks_file" 2>/dev/null)
        if [[ -n "$cleaned" ]]; then
            echo "$cleaned" > "$hooks_file"
        fi

        # Merge with existing hooks.json — add our hooks without removing others
        local merged
        merged=$(jq -s --arg cmd "$hook_command" '
            .[0] as $existing | .[1] as $new |
            ($existing // {}) * {
                hooks: (
                    ($existing.hooks // {}) as $eh |
                    ($new.hooks // {}) as $nh |
                    ($eh | keys) + ($nh | keys) | unique | map(
                        . as $key |
                        ($eh[$key] // []) as $existing_hooks |
                        ($nh[$key] // []) as $new_hooks |
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

    success "Windsurf Cascade hooks configured: ${hooks_file}"
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
    local hooks_file="${WINDSURF_DIR}/hooks.json"

    echo ""
    echo "============================================================"
    echo -e "${GREEN}AgentsLeak v${AGENTSLEAK_VERSION} installed for Windsurf!${NC}"
    echo "============================================================"
    echo ""
    echo "Installation Summary:"
    echo "  - Hook scripts: ${HOOKS_DIR}"
    echo "  - Windsurf hooks: ${hooks_file}"
    echo "  - Configuration: ${INSTALL_DIR}/config.env"
    echo "  - Backups: ${BACKUP_DIR}"
    echo ""
    echo "Next Steps:"
    echo "  1. Start the AgentsLeak server:"
    echo "     agentsleak"
    echo ""
    if [[ "$PROJECT_MODE" == "true" ]]; then
        echo "  2. Use Windsurf in $(pwd) - only sessions started in this"
        echo "     folder will be monitored and logged."
    else
        echo "  2. Use Windsurf normally - all tool usage will be"
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
    echo "  ./uninstall-windsurf.sh"
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
                WINDSURF_DIR="$(pwd)/.windsurf"
                ;;
            --help|-h)
                echo "Usage: $0 [--unattended] [--project]"
                echo ""
                echo "Install AgentsLeak hooks for Windsurf (Cascade)."
                echo ""
                echo "Options:"
                echo "  --unattended    Skip confirmation prompts"
                echo "  --project       Install to .windsurf/hooks.json in current directory"
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
    echo "  AgentsLeak Windsurf Installer v${AGENTSLEAK_VERSION}"
    echo "  AI Agent Security Monitoring"
    echo "============================================================"
    echo ""

    if [[ "$PROJECT_MODE" == "true" ]]; then
        info "Project mode: installing to $(pwd)/.windsurf/hooks.json"
    else
        info "Global mode: installing to ~/.codeium/windsurf/hooks.json"
    fi
    echo ""

    # Confirmation prompt
    if [[ "$unattended" != "true" ]]; then
        echo "This will install AgentsLeak hooks into Windsurf."
        echo "Your existing Windsurf hooks will be backed up."
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
    backup_hooks
    copy_hook_scripts
    configure_windsurf
    create_config_file
    print_success_message
}

main "$@"
