#!/bin/bash
# =============================================================================
# AgentsLeak - PostToolUse Hook
# =============================================================================
# Runs AFTER Claude Code successfully executes a tool.
# This is for logging and analytics - we capture what was executed and results.
#
# IMPORTANT: This hook should NOT block Claude Code.
# We fire-and-forget the data to the collector and exit immediately.
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

    # Read the tool result from stdin
    # Contains tool name, inputs, outputs, timing info, etc.
    input_json=$(cat)

    # Quick validation
    if [[ -z "$input_json" ]]; then
        exit 0
    fi

    log_debug "PostToolUse received: ${input_json:0:200}..."

    # Add hook_type to the payload
    if command_exists jq; then
        input_json=$(echo "$input_json" | jq '. + {hook_type: "PostToolUse"}' 2>/dev/null || echo "$input_json")
    fi

    # Enrich the payload with metadata
    enriched_json=$(enrich_payload "$input_json")

    # Send to collector asynchronously (fire and forget)
    # We don't wait for a response - just send and exit
    send_to_collector_async "/api/collect/post-tool-use" "$enriched_json"

    log_debug "PostToolUse data sent asynchronously"

    # Exit immediately - don't block Claude Code
    exit 0
}

# Run main function
main "$@"
