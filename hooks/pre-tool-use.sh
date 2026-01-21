#!/bin/bash
# =============================================================================
# AgentsLeak - PreToolUse Hook
# =============================================================================
# This is the MOST IMPORTANT hook for security monitoring.
# It runs BEFORE Claude Code executes any tool (Bash, Edit, Write, etc.)
#
# CRITICAL: This hook is SYNCHRONOUS. Claude Code waits for the response.
# The response can instruct Claude Code to:
#   - Allow the action (empty response or {"decision": "allow"})
#   - Block the action ({"decision": "block", "reason": "..."})
#   - Modify the action (return modified tool input)
#
# PERFORMANCE: This hook must be FAST. Default timeout is 200ms.
# If the collector is unavailable, we fail-open (allow the action).
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
    local response

    # Read the tool use request from stdin
    # Claude Code sends JSON with tool name, inputs, etc.
    input_json=$(cat)

    # Quick validation - if empty, allow
    if [[ -z "$input_json" || "$input_json" == "{}" ]]; then
        log_debug "Empty input, allowing action"
        exit 0
    fi

    log_debug "PreToolUse received: ${input_json:0:200}..."

    # Add hook_type to the payload
    if command_exists jq; then
        input_json=$(echo "$input_json" | jq '. + {hook_type: "PreToolUse"}' 2>/dev/null || echo "$input_json")
    fi

    # Enrich the payload with metadata
    enriched_json=$(enrich_payload "$input_json")

    log_debug "Enriched payload ready, sending to collector"

    # Send to collector and wait for response
    # This is synchronous - we need the response to decide whether to block
    if response=$(send_to_collector "/api/collect/pre-tool-use" "$enriched_json" "$AGENTSLEAK_SYNC_TIMEOUT"); then
        log_debug "Collector responded: ${response:0:200}..."

        # Output the response for Claude Code to read
        # The response may contain:
        # - {"decision": "block", "reason": "..."} to block the action
        # - {"decision": "allow"} or {} to allow
        # - Modified tool input to change what gets executed
        if [[ -n "$response" && "$response" != "null" ]]; then
            echo "$response"
        fi
    else
        # Collector unavailable or error - fail open (allow the action)
        log_debug "Collector unavailable, failing open (allowing action)"
    fi

    # Always exit 0 - non-zero would cause Claude Code to treat this as an error
    exit 0
}

# Run main function
main "$@"
