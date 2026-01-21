#!/bin/bash
# =============================================================================
# AgentsLeak - SessionStart Hook
# =============================================================================
# Runs when a new Claude Code session begins.
# Captures session metadata for tracking and correlation.
#
# Useful for:
# - Tracking active sessions
# - Correlating tool use events to sessions
# - Monitoring session duration and patterns
# - Detecting unusual session activity
#
# IMPORTANT: This hook should NOT block Claude Code startup.
# =============================================================================

set -euo pipefail

# Get the directory of this script and source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

# -----------------------------------------------------------------------------
# Main Logic
# -----------------------------------------------------------------------------

main() {
    local input_json
    local enriched_json

    # Read session information from stdin
    # May contain: session_id, working_directory, environment info, etc.
    input_json=$(cat)

    # If no input provided, create a minimal payload
    if [[ -z "$input_json" || "$input_json" == "{}" ]]; then
        input_json="{}"
    fi

    log_debug "SessionStart received: ${input_json:0:200}..."

    # Add session-specific metadata
    if command_exists jq; then
        local cwd
        local shell_info
        local term_info

        cwd=$(pwd 2>/dev/null || echo "unknown")
        shell_info="${SHELL:-unknown}"
        term_info="${TERM:-unknown}"

        enriched_json=$(echo "$input_json" | jq \
            --arg cwd "$cwd" \
            --arg shell "$shell_info" \
            --arg term "$term_info" \
            --arg parent_pid "$PPID" \
            '. + {
                _session_info: {
                    working_directory: $cwd,
                    shell: $shell,
                    terminal: $term,
                    parent_pid: $parent_pid
                },
                _event_type: "session_start"
            }' 2>/dev/null || echo "$input_json")
        enriched_json=$(enrich_payload "$enriched_json")
    else
        enriched_json=$(enrich_payload "$input_json")
    fi

    # Send to collector asynchronously (fire and forget)
    send_to_collector_async "/api/collect/session-start" "$enriched_json"

    log_debug "SessionStart data sent asynchronously"

    # Exit immediately - don't block Claude Code startup
    exit 0
}

# Run main function
main "$@"
