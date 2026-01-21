#!/bin/bash
# =============================================================================
# AgentsLeak - SubagentStop Hook
# =============================================================================
# Runs when a Claude Code subagent completes its task.
# Completes the subagent lifecycle pair (start → stop).
#
# Useful for:
# - Tracking subagent duration and lifecycle
# - Detecting subagents that run unexpectedly long
# - Correlating subagent results with parent sessions
# - Completing the delegation chain audit trail
#
# IMPORTANT: This hook should NOT block subagent completion.
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

    # Read subagent stop information from stdin
    # May contain: subagent_id, parent_session_id, result summary, etc.
    input_json=$(cat)

    # If no input provided, create a minimal payload
    if [[ -z "$input_json" || "$input_json" == "{}" ]]; then
        input_json="{}"
    fi

    log_debug "SubagentStop received: ${input_json:0:200}..."

    # Add subagent-specific metadata
    if command_exists jq; then
        enriched_json=$(echo "$input_json" | jq \
            '. + {_event_type: "subagent_stop"}' 2>/dev/null || echo "$input_json")
        enriched_json=$(enrich_payload "$enriched_json")
    else
        enriched_json=$(enrich_payload "$input_json")
    fi

    # Send to collector asynchronously (fire and forget)
    send_to_collector_async "/api/collect/subagent-stop" "$enriched_json"

    log_debug "SubagentStop data sent asynchronously"

    # Exit immediately - don't block subagent completion
    exit 0
}

# Run main function
main "$@"
