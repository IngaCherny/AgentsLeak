#!/bin/bash
# =============================================================================
# AgentsLeak - Choose which Claude Code sessions are monitored
# =============================================================================
# Usage:
#   ./scripts/set-scope.sh status               show the current scope
#   ./scripts/set-scope.sh global               monitor every Claude Code session
#   ./scripts/set-scope.sh project [DIR...]     monitor only sessions started in
#                                               these folders (default: current dir)
#   ./scripts/set-scope.sh add DIR...           add folders to the project list
#   ./scripts/set-scope.sh remove DIR...        stop monitoring these folders
#   ./scripts/set-scope.sh choose               ask interactively
#   ./scripts/set-scope.sh apply                re-install hooks for the saved scope
#
# The choice is saved in ~/.agentsleak/scope.conf, so start.sh reuses it.
# Switching scope removes AgentsLeak hooks from the old location, so events are
# never recorded twice. Only AgentsLeak's own hooks are touched.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_DIR="${HOME}/.agentsleak"
SCOPE_FILE="${INSTALL_DIR}/scope.conf"
LOG_FILE="${INSTALL_DIR}/install.log"
GLOBAL_SETTINGS="${HOME}/.claude/settings.json"

if [[ -t 1 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
fi

info()    { echo -e "${BLUE}[scope]${NC} $1"; }
success() { echo -e "${GREEN}[scope]${NC} $1"; }
warn()    { echo -e "${YELLOW}[scope]${NC} $1"; }
fail()    { echo -e "${RED}[scope]${NC} $1" >&2; exit 1; }

usage() {
    sed -n '4,13p' "$0" | sed 's/^# //'
}

# -----------------------------------------------------------------------------
# Saved configuration
# -----------------------------------------------------------------------------

SCOPE=""
PROJECTS=()

load_config() {
    SCOPE=""
    PROJECTS=()
    [[ -f "$SCOPE_FILE" ]] || return 0
    local key value
    while IFS='=' read -r key value; do
        case "$key" in
            scope)   SCOPE="$value" ;;
            project) [[ -n "$value" ]] && PROJECTS+=("$value") ;;
        esac
    done < "$SCOPE_FILE"
}

save_config() {
    mkdir -p "$INSTALL_DIR"
    {
        echo "# Written by scripts/set-scope.sh — edit with that script"
        echo "scope=${SCOPE}"
        local p
        for p in ${PROJECTS[@]+"${PROJECTS[@]}"}; do
            echo "project=${p}"
        done
    } > "$SCOPE_FILE"
}

# Absolute path of an existing directory (accepts ~ and relative paths).
resolve_dir() {
    local dir="${1/#\~/$HOME}"
    [[ -d "$dir" ]] || fail "Folder not found: $1"
    (cd "$dir" && pwd)
}

in_projects() {
    local needle="$1" p
    for p in ${PROJECTS[@]+"${PROJECTS[@]}"}; do
        [[ "$p" == "$needle" ]] && return 0
    done
    return 1
}

# -----------------------------------------------------------------------------
# Hook installation (wraps hooks/install.sh and hooks/uninstall.sh)
# -----------------------------------------------------------------------------

require_jq() {
    command -v jq >/dev/null 2>&1 || fail "jq is required. Install it with: brew install jq"
}

has_agentsleak_hooks() {
    local settings="$1"
    [[ -f "$settings" ]] && grep -q '\.agentsleak' "$settings" 2>/dev/null
}

run_quiet() {
    # Installer output is long; keep it in a log and show it only on failure.
    mkdir -p "$INSTALL_DIR"
    if ! "$@" >> "$LOG_FILE" 2>&1; then
        tail -20 "$LOG_FILE" >&2
        fail "Command failed (full log: $LOG_FILE)"
    fi
}

install_global() {
    run_quiet bash "$REPO_DIR/hooks/install.sh" --unattended
    success "Hooks installed globally (${GLOBAL_SETTINGS})"
}

uninstall_global() {
    if has_agentsleak_hooks "$GLOBAL_SETTINGS"; then
        run_quiet bash "$REPO_DIR/hooks/uninstall.sh" --unattended
        success "Removed global hooks (${GLOBAL_SETTINGS})"
    fi
}

install_project() {
    local dir="$1"
    run_quiet bash -c 'cd "$1" && bash "$2/hooks/install.sh" --unattended --project' _ "$dir" "$REPO_DIR"
    success "Hooks installed for ${dir}"
}

uninstall_project() {
    local dir="$1"
    if [[ -d "$dir" ]] && has_agentsleak_hooks "$dir/.claude/settings.json"; then
        run_quiet bash -c 'cd "$1" && bash "$2/hooks/uninstall.sh" --unattended --project' _ "$dir" "$REPO_DIR"
        success "Removed hooks from ${dir}"
    fi
}

# -----------------------------------------------------------------------------
# Commands
# -----------------------------------------------------------------------------

cmd_status() {
    load_config
    echo ""
    case "$SCOPE" in
        global)  echo -e "  Scope: ${GREEN}all Claude Code sessions${NC} (global)" ;;
        project) echo -e "  Scope: ${GREEN}specific projects${NC}" ;;
        *)       echo -e "  Scope: ${YELLOW}not configured yet${NC} (run: ./scripts/set-scope.sh choose)" ;;
    esac
    echo ""
    if has_agentsleak_hooks "$GLOBAL_SETTINGS"; then
        echo -e "  ${GREEN}●${NC} global     ${GLOBAL_SETTINGS}"
    else
        echo -e "  ○ global     not installed"
    fi
    local p
    for p in ${PROJECTS[@]+"${PROJECTS[@]}"}; do
        if has_agentsleak_hooks "$p/.claude/settings.json"; then
            echo -e "  ${GREEN}●${NC} project    $p"
        else
            echo -e "  ${YELLOW}○${NC} project    $p (hooks missing — run: ./scripts/set-scope.sh apply)"
        fi
    done
    echo ""
}

cmd_global() {
    require_jq
    load_config
    local p
    for p in ${PROJECTS[@]+"${PROJECTS[@]}"}; do
        uninstall_project "$p"
    done
    install_global
    SCOPE=global
    PROJECTS=()
    save_config
}

# Replace the project list (or add to it with append=true).
cmd_project() {
    local append="$1"
    shift
    require_jq
    load_config

    local dirs=() d
    if [[ $# -eq 0 ]]; then
        dirs+=("$(resolve_dir "$PWD")")
    else
        for d in "$@"; do
            dirs+=("$(resolve_dir "$d")")
        done
    fi

    local old=(${PROJECTS[@]+"${PROJECTS[@]}"})
    if [[ "$append" != "true" || "$SCOPE" != "project" ]]; then
        # Drop hooks from folders that are no longer in the list.
        PROJECTS=("${dirs[@]}")
        for d in ${old[@]+"${old[@]}"}; do
            in_projects "$d" || uninstall_project "$d"
        done
    else
        for d in "${dirs[@]}"; do
            in_projects "$d" || PROJECTS+=("$d")
        done
    fi

    uninstall_global
    for d in "${dirs[@]}"; do
        install_project "$d"
    done
    SCOPE=project
    save_config
}

cmd_remove() {
    [[ $# -gt 0 ]] || fail "Usage: $0 remove DIR..."
    require_jq
    load_config
    local d target keep=()
    for d in "$@"; do
        target="${d/#\~/$HOME}"
        [[ -d "$target" ]] && target="$(cd "$target" && pwd)"
        uninstall_project "$target"
        keep=()
        local p
        for p in ${PROJECTS[@]+"${PROJECTS[@]}"}; do
            [[ "$p" == "$target" ]] || keep+=("$p")
        done
        PROJECTS=(${keep[@]+"${keep[@]}"})
    done
    save_config
    [[ ${#PROJECTS[@]} -eq 0 && "$SCOPE" == "project" ]] && \
        warn "No projects left — nothing is monitored. Run '$0 global' or '$0 add DIR'."
    return 0
}

cmd_apply() {
    load_config
    case "$SCOPE" in
        global)  require_jq; install_global ;;
        project)
            require_jq
            local p
            for p in ${PROJECTS[@]+"${PROJECTS[@]}"}; do
                if [[ -d "$p" ]]; then install_project "$p"; else warn "Skipping missing folder: $p"; fi
            done
            ;;
        *) fail "No scope saved yet. Run: $0 choose" ;;
    esac
}

cmd_choose() {
    [[ -t 0 ]] || fail "Not an interactive terminal. Use '$0 global' or '$0 project DIR'."
    echo ""
    echo "Which Claude Code sessions should AgentsLeak monitor?"
    echo "  1) All sessions on this machine (global)"
    echo "  2) Only sessions started in specific project folders"
    echo ""
    local choice
    read -r -p "Choose [1/2] (default 1): " choice
    case "${choice:-1}" in
        1) cmd_global ;;
        2)
            echo ""
            echo "Enter project folders, one per line. Empty line when done."
            echo "(Press Enter right away to use: ${CALLER_DIR})"
            local dirs=() line
            while IFS= read -r -p "  folder: " line; do
                [[ -z "$line" ]] && break
                dirs+=("$line")
            done
            [[ ${#dirs[@]} -eq 0 ]] && dirs=("$CALLER_DIR")
            cmd_project false "${dirs[@]}"
            ;;
        *) fail "Invalid choice: $choice" ;;
    esac
}

# -----------------------------------------------------------------------------

# Folder the user ran from (start.sh passes it through, since it cd's away).
CALLER_DIR="${AGENTSLEAK_CALLER_DIR:-$PWD}"
cd "$CALLER_DIR"

case "${1:-status}" in
    status)  cmd_status ;;
    global)  cmd_global ;;
    project) shift; cmd_project false "$@" ;;
    add)     shift; cmd_project true "$@" ;;
    remove)  shift; cmd_remove "$@" ;;
    apply)   cmd_apply ;;
    choose)  cmd_choose ;;
    -h|--help|help) usage ;;
    *) usage; exit 1 ;;
esac
