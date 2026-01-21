#!/bin/bash
# =============================================================================
# AgentsLeak - SubagentStart Hook
# =============================================================================
# Runs when Claude Code spawns a subagent (nested agent task).
# Important for tracking agent hierarchies and delegation patterns.
#
# Security implications:
# - Subagents may have different permission contexts
# - Delegation chains can be used to obscure malicious intent
# - Tracking parent-child relationships helps with attribution
#
# IMPORTANT: This hook should NOT block subagent creation.
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

    # Read subagent information from stdin
    # May contain: subagent_id, parent_session_id, task description, permissions, etc.
    input_json=$(cat)

    # If no input provided, create a minimal payload
    if [[ -z "$input_json" || "$input_json" == "{}" ]]; then
        input_json="{}"
    fi

    log_debug "SubagentStart received: ${input_json:0:200}..."

    # Add subagent-specific metadata
    if command_exists jq; then
        enriched_json=$(echo "$input_json" | jq \
            '. + {_event_type: "subagent_start"}' 2>/dev/null || echo "$input_json")
        enriched_json=$(enrich_payload "$enriched_json")
    else
        enriched_json=$(enrich_payload "$input_json")
    fi

    # Send to collector asynchronously (fire and forget)
    send_to_collector_async "/api/collect/subagent-start" "$enriched_json"

    log_debug "SubagentStart data sent asynchronously"

    # Exit immediately - don't block subagent creation
    exit 0
}

# Run main function
main "$@"
