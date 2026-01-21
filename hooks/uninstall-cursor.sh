#!/bin/bash
# =============================================================================
# AgentsLeak - Cursor Uninstaller Script
# =============================================================================
# Removes AgentsLeak hooks from Cursor.
#
# What this script does:
# 1. Backs up ~/.cursor/hooks.json
# 2. Selectively removes AgentsLeak hook entries
# 3. Optionally removes ~/.agentsleak/ directory (--full)
#
# Usage:
#   ./uninstall-cursor.sh [--full] [--unattended] [--project]
#
# Options:
#   --full          Also remove ~/.agentsleak/ directory and all data
#   --unattended    Skip confirmation prompts
#   --project       Target .cursor/hooks.json in current directory
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

INSTALL_DIR="${HOME}/.agentsleak"
BACKUP_DIR="${INSTALL_DIR}/backups"

# Default to global
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
# Uninstallation Functions
# -----------------------------------------------------------------------------

backup_cursor_hooks() {
    local hooks_file="${CURSOR_DIR}/hooks.json"

    if [[ -f "$hooks_file" ]]; then
        mkdir -p "$BACKUP_DIR"
        local backup_file="${BACKUP_DIR}/cursor-hooks.json.$(date +%Y%m%d_%H%M%S).pre-uninstall.bak"
        info "Backing up current Cursor hooks..."
        cp "$hooks_file" "$backup_file"
        success "Cursor hooks backed up to ${backup_file}"
    fi
}

remove_hooks_selective() {
    local hooks_file="${CURSOR_DIR}/hooks.json"

    info "Selectively removing AgentsLeak hooks from Cursor..."

    if [[ ! -f "$hooks_file" ]]; then
        info "No Cursor hooks file found - nothing to remove"
        return 0
    fi

    if ! command_exists jq; then
        error "jq is required to modify hooks.json. Please remove hooks manually."
        echo ""
        echo "Manual removal instructions:"
        echo "  1. Open ${hooks_file}"
        echo "  2. Remove entries with commands pointing to .agentsleak"
        echo "  3. Save the file"
        return 1
    fi

    # Check if hooks.json is valid JSON
    if ! jq empty "$hooks_file" 2>/dev/null; then
        error "hooks.json is not valid JSON"
        return 1
    fi

    # Remove hook entries whose command contains ".agentsleak"
    local updated
    updated=$(jq '
        if .hooks then
            .hooks |= with_entries(
                .value |= map(select(.command | contains(".agentsleak") | not))
            ) |
            # Remove empty event arrays
            .hooks |= with_entries(select(.value | length > 0)) |
            # If no hooks remain, remove the hooks key
            if (.hooks | length) == 0 then del(.hooks) else . end
        else
            .
        end
    ' "$hooks_file")

    # Check if anything meaningful remains
    local remaining_keys
    remaining_keys=$(echo "$updated" | jq 'keys | length' 2>/dev/null || echo "0")

    if [[ "$remaining_keys" -le 1 ]]; then
        # Only "version" or nothing left — remove the file
        rm -f "$hooks_file"
        success "Cursor hooks file removed (no non-AgentsLeak hooks remaining)"
    else
        echo "$updated" | jq '.' > "$hooks_file"
        success "AgentsLeak hooks selectively removed from Cursor"
    fi
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
    echo -e "${GREEN}AgentsLeak uninstalled from Cursor!${NC}"
    echo "============================================================"
    echo ""
    echo "What was removed:"
    echo "  - AgentsLeak hooks from Cursor configuration"

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
    echo "Cursor will no longer send events to AgentsLeak."
    echo "Restart Cursor for changes to take effect."
    echo ""
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

main() {
    local full_removal=false
    local unattended=false

    # Parse arguments
    for arg in "$@"; do
        case $arg in
            --full)
                full_removal=true
                ;;
            --unattended)
                unattended=true
                ;;
            --project)
                PROJECT_MODE=true
                CURSOR_DIR="$(pwd)/.cursor"
                ;;
            --help|-h)
                echo "Usage: $0 [--full] [--unattended] [--project]"
                echo ""
                echo "Uninstall AgentsLeak hooks from Cursor."
                echo ""
                echo "Options:"
                echo "  --full          Also remove ~/.agentsleak/ directory and all data"
                echo "  --unattended    Skip confirmation prompts"
                echo "  --project       Target .cursor/hooks.json in current directory"
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
    echo "  AgentsLeak Cursor Uninstaller"
    echo "============================================================"
    echo ""

    if [[ "$PROJECT_MODE" == "true" ]]; then
        info "Project mode: targeting $(pwd)/.cursor/hooks.json"
    fi

    # Confirmation prompt
    if [[ "$unattended" != "true" ]]; then
        echo "This will remove AgentsLeak hooks from Cursor."
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
    backup_cursor_hooks

    # Remove AgentsLeak hooks from Cursor
    remove_hooks_selective

    # Optionally remove installation directory
    if [[ "$full_removal" == "true" ]]; then
        remove_install_directory
    fi

    print_success_message "$full_removal"
}

main "$@"
