#!/bin/bash
# =============================================================================
# AgentsLeak - Stop Hook
# =============================================================================
# Runs when Claude finishes a turn (its reply is complete).
# Sends the reply and Claude's mid-turn notes so the dashboard can show the
# full conversation: prompt -> notes -> tool calls -> reply.
#
# - reply: the Stop payload's last_assistant_message
# - notes: text Claude wrote between tool calls, read from the transcript
#          (see lib/extract-turn.jq), each linked to the tool call it precedes
#
# Set AGENTSLEAK_CAPTURE_RESPONSES=0 in ~/.agentsleak/config.env to send only
# the turn-completed marker, without any text.
#
# IMPORTANT: This hook never blocks Claude from stopping. All work happens in
# the background and the hook exits immediately.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

EXTRACT_FILTER="${SCRIPT_DIR}/lib/extract-turn.jq"

# Transcript lines to scan when the prompt can't be located by its id.
FALLBACK_TAIL_LINES=2000

# Notes for this turn as {"notes": [...], "truncated": bool}.
extract_notes() {
    local transcript="$1" prompt_id="$2" reply="$3"
    local empty='{"notes":[],"truncated":false}'

    if [[ -z "$transcript" || ! -r "$transcript" || ! -r "$EXTRACT_FILTER" ]]; then
        echo "$empty"
        return 0
    fi

    local start_line=""
    if [[ -n "$prompt_id" ]]; then
        start_line=$(grep -n -m1 -F "\"promptId\":\"${prompt_id}\"" "$transcript" 2>/dev/null | cut -d: -f1 || true)
    fi

    local notes
    if [[ -n "$start_line" ]]; then
        notes=$(tail -n "+${start_line}" "$transcript" | jq -n -c \
            --arg pid "$prompt_id" --arg reply "$reply" \
            --argjson note_max "$AGENTSLEAK_MAX_NOTE_CHARS" \
            -f "$EXTRACT_FILTER" 2>/dev/null) || notes=""
    else
        notes=$(tail -n "$FALLBACK_TAIL_LINES" "$transcript" | jq -n -c \
            --arg pid "" --arg reply "$reply" \
            --argjson note_max "$AGENTSLEAK_MAX_NOTE_CHARS" \
            -f "$EXTRACT_FILTER" 2>/dev/null) || notes=""
    fi

    echo "${notes:-$empty}"
}

process_stop() {
    local input_json="$1"

    local capture="${AGENTSLEAK_CAPTURE_RESPONSES}"
    local payload

    if [[ "$capture" == "0" ]]; then
        payload=$(echo "$input_json" | jq -c \
            'del(.last_assistant_message) + {_event_type: "stop", reply: null, notes: []}')
    else
        local reply transcript prompt_id notes_json
        reply=$(echo "$input_json" | jq -r '.last_assistant_message // ""')
        transcript=$(echo "$input_json" | jq -r '.transcript_path // ""')
        prompt_id=$(echo "$input_json" | jq -r '.prompt_id // ""')
        notes_json=$(extract_notes "$transcript" "$prompt_id" "$reply")

        payload=$(echo "$input_json" | jq -c \
            --argjson extracted "$notes_json" \
            --argjson reply_max "$AGENTSLEAK_MAX_REPLY_CHARS" '
            (.last_assistant_message // null) as $reply
            | del(.last_assistant_message)
            + {
                _event_type: "stop",
                reply: (if $reply == null then null else $reply[0:$reply_max] end),
                notes: $extracted.notes,
                capture_truncated: ($extracted.truncated
                    or ($reply != null and ($reply | length) > $reply_max))
              }')
    fi

    payload=$(enrich_payload "$payload")
    send_to_collector_async "/api/collect/stop" "$payload"
    log_debug "Stop data sent asynchronously"
}

main() {
    local input_json
    input_json=$(cat)

    if [[ -z "$input_json" || "$input_json" == "{}" ]] || ! command_exists jq; then
        exit 0
    fi

    # Detach: reading the transcript must never delay Claude.
    ( process_stop "$input_json" ) >/dev/null 2>&1 &

    exit 0
}

main "$@"
