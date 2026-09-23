#!/bin/bash
# =============================================================================
# AgentsLeak - Codex CLI Uninstaller Script
# =============================================================================
# Removes AgentsLeak hooks from Codex CLI.
#
# What this script does:
# 1. Removes hook configuration from Codex CLI's hooks.json
# 2. Optionally removes ~/.agentsleak/ directory
#
# Usage:
#   ./uninstall-codex.sh [--full] [--unattended] [--project]
#
# Options:
#   --full          Also remove ~/.agentsleak/ directory and all data
#   --unattended    Skip confirmation prompts
#   --project       Target .codex/hooks.json in current directory
#                    instead of the global ~/.codex/hooks.json
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

INSTALL_DIR="${HOME}/.agentsleak"
HOOKS_DIR="${INSTALL_DIR}/hooks"
CODEX_SETTINGS_DIR="${HOME}/.codex"
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
# Uninstallation Functions
# -----------------------------------------------------------------------------

backup_settings() {
    if [[ -f "$CODEX_SETTINGS_FILE" ]]; then
        mkdir -p "$BACKUP_DIR"
        local backup_file="${BACKUP_DIR}/codex-hooks.json.$(date +%Y%m%d_%H%M%S).pre-uninstall.bak"
        info "Backing up current Codex CLI hooks.json..."
        cp "$CODEX_SETTINGS_FILE" "$backup_file"
        success "Settings backed up to ${backup_file}"
    fi
}

remove_hooks_from_settings() {
    info "Removing AgentsLeak hooks from Codex CLI hooks.json..."

    if [[ ! -f "$CODEX_SETTINGS_FILE" ]]; then
        info "No Codex CLI hooks.json found - nothing to remove"
        return 0
    fi

    if ! command_exists jq; then
        error "jq is required to modify settings. Please remove hooks manually."
        echo ""
        echo "Manual removal instructions:"
        echo "  1. Open ${CODEX_SETTINGS_FILE}"
        echo "  2. Remove the 'hooks' section containing AgentsLeak paths"
        echo "  3. Save the file"
        return 1
    fi

    if ! jq empty "$CODEX_SETTINGS_FILE" 2>/dev/null; then
        error "Settings file is not valid JSON"
        return 1
    fi

    if ! jq -e '.hooks' "$CODEX_SETTINGS_FILE" >/dev/null 2>&1; then
        info "No hooks found in Codex CLI hooks.json - nothing to remove"
        return 0
    fi

    # Remove the hooks section entirely
    # Note: This removes ALL hooks, not just AgentsLeak hooks
    local updated
    updated=$(jq 'del(.hooks)' "$CODEX_SETTINGS_FILE")

    echo "$updated" | jq '.' > "$CODEX_SETTINGS_FILE"

    success "Hooks removed from Codex CLI hooks.json"
}

remove_hooks_selective() {
    # More selective removal - only removes hooks pointing to AgentsLeak
    info "Selectively removing AgentsLeak hooks from Codex CLI hooks.json..."

    if [[ ! -f "$CODEX_SETTINGS_FILE" ]]; then
        info "No Codex CLI hooks.json found - nothing to remove"
        return 0
    fi

    if ! command_exists jq; then
        warn "jq not available, falling back to full hooks removal"
        remove_hooks_from_settings
        return $?
    fi

    # Remove hooks that contain ".agentsleak" in their command
    local updated
    updated=$(jq '
        if .hooks then
            .hooks |= with_entries(
                .value |= (
                    map(.hooks |= map(select(.command | contains(".agentsleak") | not)))
                    | map(select(.hooks | length > 0))
                )
            ) |
            if .hooks | to_entries | map(select(.value | length > 0)) | length == 0 then
                del(.hooks)
            else
                .
            end
        else
            .
        end
    ' "$CODEX_SETTINGS_FILE")

    echo "$updated" | jq '.' > "$CODEX_SETTINGS_FILE"

    success "AgentsLeak hooks selectively removed"
}

remove_install_directory() {
    if [[ -d "$INSTALL_DIR" ]]; then
        info "Removing AgentsLeak installation directory..."
        rm -rf "$INSTALL_DIR"
        success "Removed ${INSTALL_DIR}"
    else
        info "Installation directory not found - nothing to remove"
    fi
}

print_success_message() {
    local full_removal=$1

    echo ""
    echo "============================================================"
    echo -e "${GREEN}AgentsLeak uninstalled successfully!${NC}"
    echo "============================================================"
    echo ""
    echo "What was removed:"
    echo "  - AgentsLeak hooks from Codex CLI hooks.json"

    if [[ "$full_removal" == "true" ]]; then
        echo "  - Installation directory: ${INSTALL_DIR}"
        echo "  - All hook scripts and configuration"
        echo "  - Backups (were in ${BACKUP_DIR})"
    else
        echo ""
        echo "What was kept:"
        echo "  - Installation directory: ${INSTALL_DIR}"
        echo "  - Hook scripts (for potential reinstall)"
        echo "  - Configuration and backups"
        echo ""
        echo "To completely remove all AgentsLeak files, run:"
        echo "  rm -rf ${INSTALL_DIR}"
    fi

    echo ""
    echo "Codex CLI will no longer send events to AgentsLeak."
    echo "Restart Codex CLI for changes to take effect."
    echo ""
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

main() {
    local full_removal=false
    local unattended=false
    local selective=true

    # Parse arguments
    for arg in "$@"; do
        case $arg in
            --full)
                full_removal=true
                ;;
            --unattended)
                unattended=true
                ;;
            --all-hooks)
                # Hidden flag to remove ALL hooks, not just AgentsLeak
                selective=false
                ;;
            --project)
                PROJECT_MODE=true
                CODEX_SETTINGS_DIR="$(pwd)/.codex"
                ;;
            --help|-h)
                echo "Usage: $0 [--full] [--unattended] [--project]"
                echo ""
                echo "Uninstall AgentsLeak hooks from Codex CLI."
                echo ""
                echo "Options:"
                echo "  --full          Also remove ~/.agentsleak/ directory and all data"
                echo "  --unattended    Skip confirmation prompts"
                echo "  --project       Target .codex/hooks.json in current directory"
                echo "  --help, -h      Show this help message"
                exit 0
                ;;
            *)
                die "Unknown option: $arg"
                ;;
        esac
    done

    CODEX_SETTINGS_FILE="${CODEX_SETTINGS_DIR}/hooks.json"

    echo ""
    echo "============================================================"
    echo "  AgentsLeak Codex CLI Uninstaller"
    echo "============================================================"
    echo ""

    # Confirmation prompt
    if [[ "$unattended" != "true" ]]; then
        echo "This will remove AgentsLeak hooks from Codex CLI."
        if [[ "$full_removal" == "true" ]]; then
            echo -e "${YELLOW}WARNING: --full flag specified - this will also remove${NC}"
            echo -e "${YELLOW}all AgentsLeak files including backups and logs.${NC}"
        fi
        echo ""
        read -p "Continue with uninstallation? [y/N] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Uninstallation cancelled."
            exit 0
        fi
        echo ""
    fi

    # Backup before making changes
    backup_settings

    # Remove hooks from Codex CLI hooks.json
    if [[ "$selective" == "true" ]]; then
        remove_hooks_selective
    else
        remove_hooks_from_settings
    fi

    # Optionally remove installation directory
    if [[ "$full_removal" == "true" ]]; then
        remove_install_directory
    fi

    print_success_message "$full_removal"
}

main "$@"
