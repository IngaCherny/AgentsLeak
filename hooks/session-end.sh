#!/bin/bash
# =============================================================================
# AgentsLeak - SessionEnd Hook
# =============================================================================
# Runs when a Claude Code session ends.
# Captures final session state and statistics.
#
# Useful for:
# - Session duration tracking
# - Final state capture
# - Cleanup notifications
# - Anomaly detection (unusual session endings)
#
# IMPORTANT: This hook should NOT block Claude Code shutdown.
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

    # Read session end information from stdin
    # May contain: session_id, exit_reason, statistics, etc.
    input_json=$(cat)

    # If no input provided, create a minimal payload
    if [[ -z "$input_json" || "$input_json" == "{}" ]]; then
        input_json="{}"
    fi

    log_debug "SessionEnd received: ${input_json:0:200}..."

    # Add session end metadata
    if command_exists jq; then
        enriched_json=$(echo "$input_json" | jq \
            '. + {_event_type: "session_end"}' 2>/dev/null || echo "$input_json")
        enriched_json=$(enrich_payload "$enriched_json")
    else
        enriched_json=$(enrich_payload "$input_json")
    fi

    # Send to collector asynchronously (fire and forget)
    # Note: We still use async here even though session is ending
    # The background process will complete independently
    send_to_collector_async "/api/collect/session-end" "$enriched_json"

    log_debug "SessionEnd data sent asynchronously"

    # Exit immediately
    exit 0
}

# Run main function
main "$@"
