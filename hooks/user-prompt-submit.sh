#!/bin/bash
# =============================================================================
# AgentsLeak - UserPromptSubmit Hook
# =============================================================================
# Runs when a user submits a prompt to Claude Code.
# Logs user prompts for audit trail and prompt injection detection.
#
# Useful for:
# - Tracking what users ask the agent to do
# - Detecting prompt injection attempts
# - Audit trail of all user-agent interactions
# - Correlating user requests with tool executions
#
# IMPORTANT: This hook should NOT block prompt submission.
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

    # Read prompt information from stdin
    # May contain: session_id, prompt text, etc.
    input_json=$(cat)

    # If no input provided, create a minimal payload
    if [[ -z "$input_json" || "$input_json" == "{}" ]]; then
        input_json="{}"
    fi

    log_debug "UserPromptSubmit received: ${input_json:0:200}..."

    # Add event type metadata
    if command_exists jq; then
        enriched_json=$(echo "$input_json" | jq \
            '. + {_event_type: "user_prompt_submit"}' 2>/dev/null || echo "$input_json")
        enriched_json=$(enrich_payload "$enriched_json")
    else
        enriched_json=$(enrich_payload "$input_json")
    fi

    # Send to collector asynchronously (fire and forget)
    send_to_collector_async "/api/collect/user-prompt-submit" "$enriched_json"

    log_debug "UserPromptSubmit data sent asynchronously"

    # Exit immediately - don't block prompt submission
    exit 0
}

# Run main function
main "$@"
