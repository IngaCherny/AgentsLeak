#!/bin/bash
# =============================================================================
# AgentsLeak - PreCompact Hook
# =============================================================================
# Runs BEFORE Claude Code compacts the conversation context.
# Compaction summarizes/discards earlier turns to fit the context window —
# anything not snapshotted now becomes unrecoverable from the live transcript.
#
# Why this matters for security monitoring:
# - Audit trail integrity: without this snapshot, the forensic record has
#   a hole at every compaction boundary. Reconstructing what the agent
#   saw or said before compaction becomes impossible from in-session state.
# - Sensitive-data crossover: secrets, credentials, or tool outputs that
#   were in context are about to be lossy-summarized. Capture once so the
#   collector can scan/redact/alert before the original is gone.
# - Compaction frequency anomalies: rapid repeated compactions can signal
#   prompt-stuffing attacks or runaway loops.
#
# Payload fields Claude Code sends (per its hook spec):
#   session_id, transcript_path, trigger ("manual" | "auto"),
#   custom_instructions (when trigger="manual")
#
# IMPORTANT: This hook should NOT block compaction. Fire-and-forget.
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

    # Read compaction context from stdin
    input_json=$(cat)

    # If no input provided, create a minimal payload
    if [[ -z "$input_json" || "$input_json" == "{}" ]]; then
        input_json="{}"
    fi

    log_debug "PreCompact received: ${input_json:0:200}..."

    # Tag the payload so the collector knows which hook produced it
    if command_exists jq; then
        enriched_json=$(echo "$input_json" | jq \
            '. + {hook_type: "PreCompact", _event_type: "pre_compact"}' 2>/dev/null || echo "$input_json")
        enriched_json=$(enrich_payload "$enriched_json")
    else
        enriched_json=$(enrich_payload "$input_json")
    fi

    # Send to collector asynchronously (fire and forget)
    send_to_collector_async "/api/collect/pre-compact" "$enriched_json"

    log_debug "PreCompact data sent asynchronously"

    # Exit immediately - don't block compaction
    exit 0
}

# Run main function
main "$@"
