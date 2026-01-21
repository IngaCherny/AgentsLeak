#!/bin/bash
# =============================================================================
# AgentsLeak - PostToolUseFailure Hook
# =============================================================================
# Runs AFTER Claude Code fails to execute a tool (error occurred).
# Captures error information for security analysis and debugging.
#
# Error patterns can indicate:
# - Permission issues (potential privilege escalation attempts)
# - Missing files (reconnaissance activity)
# - Command failures (malformed attacks)
# - Network errors (exfiltration attempts blocked)
#
# IMPORTANT: This hook should NOT block Claude Code.
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

    # Read the error information from stdin
    # Contains tool name, inputs, error message, stack trace, etc.
    input_json=$(cat)

    # Quick validation
    if [[ -z "$input_json" ]]; then
        exit 0
    fi

    log_debug "PostToolUseError received: ${input_json:0:200}..."

    # Add hook_type and enrich the payload with metadata
    if command_exists jq; then
        enriched_json=$(echo "$input_json" | jq '. + {hook_type: "PostToolUseFailure", _event_type: "tool_error"}' 2>/dev/null || echo "$input_json")
        enriched_json=$(enrich_payload "$enriched_json")
    else
        enriched_json=$(enrich_payload "$input_json")
    fi

    # Send to collector asynchronously (fire and forget)
    send_to_collector_async "/api/collect/post-tool-use-error" "$enriched_json"

    log_debug "PostToolUseError data sent asynchronously"

    # Exit immediately - don't block Claude Code
    exit 0
}

# Run main function
main "$@"
