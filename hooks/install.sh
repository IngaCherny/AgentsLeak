#!/bin/bash
# =============================================================================
# AgentsLeak - Installer Script
# =============================================================================
# Installs AgentsLeak hooks into Claude Code.
#
# What this script does:
# 1. Detects Claude Code settings file location
# 2. Backs up existing settings
# 3. Copies hook scripts to ~/.agentsleak/hooks/
# 4. Merges hook configurations into Claude Code settings
# 5. Makes all scripts executable
#
# Usage:
#   ./install.sh [--unattended] [--project]
#
# Options:
#   --unattended    Skip confirmation prompts
#   --project       Install to .claude/settings.json in cwd instead of global —
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
CLAUDE_SETTINGS_DIR="${HOME}/.claude"
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
    mkdir -p "$CLAUDE_SETTINGS_DIR"

    success "Directories created"
}

backup_settings() {
    if [[ -f "$CLAUDE_SETTINGS_FILE" ]]; then
        local backup_file="${BACKUP_DIR}/settings.json.$(date +%Y%m%d_%H%M%S).bak"
        info "Backing up existing Claude Code settings to ${backup_file}..."
        cp "$CLAUDE_SETTINGS_FILE" "$backup_file"
        success "Settings backed up"
    else
        info "No existing Claude Code settings found (will create new)"
    fi
}

copy_hook_scripts() {
    local source_dir
    source_dir=$(get_script_dir)

    info "Copying hook scripts to ${HOOKS_DIR}..."

    # List of scripts to copy
    local scripts=(
        "common.sh"
        "pre-tool-use.sh"
        "post-tool-use.sh"
        "post-tool-use-error.sh"
        "pre-compact.sh"
        "session-start.sh"
        "session-end.sh"
        "subagent-start.sh"
        "subagent-stop.sh"
        "permission-request.sh"
        "user-prompt-submit.sh"
        "stop.sh"
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

    # Helper files used by the hooks (e.g. transcript parsing for stop.sh)
    if [[ -d "${source_dir}/lib" ]]; then
        mkdir -p "${HOOKS_DIR}/lib"
        cp "${source_dir}/lib/"* "${HOOKS_DIR}/lib/"
        info "  Installed: lib/"
    fi

    success "Hook scripts installed"
}

configure_claude_code() {
    info "Configuring Claude Code hooks..."

    # Create default settings if file doesn't exist
    if [[ ! -f "$CLAUDE_SETTINGS_FILE" ]]; then
        echo '{}' > "$CLAUDE_SETTINGS_FILE"
    fi

    # Validate existing JSON
    if ! jq empty "$CLAUDE_SETTINGS_FILE" 2>/dev/null; then
        error "Existing settings.json is not valid JSON"
        error "Please fix or remove ${CLAUDE_SETTINGS_FILE} and try again"
        exit 1
    fi

    # Hook configuration to merge
    local hook_config
    hook_config=$(cat <<EOF
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "${HOOKS_DIR}/pre-tool-use.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "${HOOKS_DIR}/post-tool-use.sh"
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "${HOOKS_DIR}/post-tool-use-error.sh"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${HOOKS_DIR}/pre-compact.sh"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${HOOKS_DIR}/session-start.sh"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${HOOKS_DIR}/session-end.sh"
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${HOOKS_DIR}/subagent-start.sh"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${HOOKS_DIR}/subagent-stop.sh"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "${HOOKS_DIR}/permission-request.sh"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${HOOKS_DIR}/user-prompt-submit.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${HOOKS_DIR}/stop.sh"
          }
        ]
      }
    ]
  }
}
EOF
)

    # Merge hook configuration into existing settings. For each event, keep the
    # user's own hooks, drop previous AgentsLeak entries (so re-running doesn't
    # duplicate them), then append ours. A plain `*` merge would replace the
    # event arrays and delete the user's hooks.
    local merged
    merged=$(jq -s '
        .[0] as $old | .[1].hooks as $new
        | $old + {hooks: (reduce ($new | keys[]) as $event (($old.hooks // {});
            .[$event] = (
                (.[$event] // [])
                | map(.hooks |= map(select((.command // "") | contains(".agentsleak") | not)))
                | map(select(.hooks | length > 0))
            ) + $new[$event]
        ))}
    ' "$CLAUDE_SETTINGS_FILE" <(echo "$hook_config"))

    # Write the merged configuration atomically
    local tmpfile
    tmpfile=$(mktemp "${CLAUDE_SETTINGS_FILE}.XXXXXX")
    echo "$merged" | jq '.' > "$tmpfile" && mv "$tmpfile" "$CLAUDE_SETTINGS_FILE"

    success "Claude Code hooks configured"
}

create_config_file() {
    local config_file="${INSTALL_DIR}/config.env"

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

# Conversation capture: Claude's replies and mid-turn notes (0 to disable)
AGENTSLEAK_CAPTURE_RESPONSES=1
AGENTSLEAK_MAX_REPLY_CHARS=20000
AGENTSLEAK_MAX_NOTE_CHARS=4000
EOF

    success "Configuration file created: ${config_file}"
}

print_success_message() {
    echo ""
    echo "============================================================"
    echo -e "${GREEN}AgentsLeak v${AGENTSLEAK_VERSION} installed successfully!${NC}"
    echo "============================================================"
    echo ""
    echo "Installation Summary:"
    echo "  - Hooks installed to: ${HOOKS_DIR}"
    echo "  - Claude Code settings: ${CLAUDE_SETTINGS_FILE}"
    echo "  - Configuration: ${INSTALL_DIR}/config.env"
    echo "  - Backups: ${BACKUP_DIR}"
    echo ""
    echo "Next Steps:"
    echo "  1. Start the AgentsLeak server:"
    echo "     agentsleak"
    echo ""
    if [[ "$PROJECT_MODE" == "true" ]]; then
        echo "  2. Start using Claude Code in $(pwd) - only sessions started"
        echo "     in this folder will be monitored and logged."
    else
        echo "  2. Start using Claude Code normally - all tool usage will"
        echo "     be monitored and logged."
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
    echo "  ${HOOKS_DIR}/../uninstall.sh"
    echo "  # or manually: Remove 'hooks' section from ${CLAUDE_SETTINGS_FILE}"
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
                CLAUDE_SETTINGS_DIR="$(pwd)/.claude"
                ;;
            --help|-h)
                echo "Usage: $0 [--unattended] [--project]"
                echo ""
                echo "Install AgentsLeak hooks for Claude Code."
                echo ""
                echo "Options:"
                echo "  --unattended    Skip confirmation prompts"
                echo "  --project       Install to .claude/settings.json in current directory"
                echo "                  instead of the global ~/.claude/settings.json — scopes"
                echo "                  monitoring to sessions started in this folder only"
                echo "  --help, -h      Show this help message"
                exit 0
                ;;
            *)
                die "Unknown option: $arg"
                ;;
        esac
    done

    CLAUDE_SETTINGS_FILE="${CLAUDE_SETTINGS_DIR}/settings.json"

    echo ""
    echo "============================================================"
    echo "  AgentsLeak Installer v${AGENTSLEAK_VERSION}"
    echo "  AI Agent Security Monitoring"
    echo "============================================================"
    echo ""

    if [[ "$PROJECT_MODE" == "true" ]]; then
        info "Project mode: installing to $(pwd)/.claude/settings.json"
    else
        info "Global mode: installing to ~/.claude/settings.json"
    fi
    echo ""

    # Confirmation prompt
    if [[ "$unattended" != "true" ]]; then
        if [[ "$PROJECT_MODE" == "true" ]]; then
            echo "This will install AgentsLeak hooks into Claude Code, scoped to this project."
        else
            echo "This will install AgentsLeak hooks into Claude Code."
        fi
        echo "Your existing Claude Code settings will be backed up."
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
    configure_claude_code
    create_config_file
    print_success_message
}

main "$@"
