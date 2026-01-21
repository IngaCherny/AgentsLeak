#!/bin/bash
# =============================================================================
# AgentsLeak - Universal Cursor Hook Adapter
# =============================================================================
# Single entry point for all Cursor hook events.
# Translates Cursor's JSON format → AgentsLeak HookPayload format,
# routes to the correct collector endpoint, and translates the response
# back to Cursor's expected format.
#
# Based on official Cursor hooks API: https://cursor.com/docs/agent/hooks
#
# Cursor hook events handled (9 total):
#   sessionStart        → /api/collect/session-start       (sync)
#   sessionEnd          → /api/collect/session-end          (async)
#   preToolUse          → /api/collect/pre-tool-use         (sync, can block)
#   postToolUse         → /api/collect/post-tool-use        (async)
#   postToolUseFailure  → /api/collect/post-tool-use-error  (async)
#   subagentStart       → /api/collect/subagent-start       (sync)
#   subagentStop        → /api/collect/subagent-stop        (sync)
#   beforeSubmitPrompt  → /api/collect/user-prompt-submit   (sync)
#   stop                → /api/collect/session-end          (sync)
#
# Cursor universal fields captured from every payload:
#   conversation_id  → session_id
#   user_email       → endpoint_user (overrides hostname detection)
#   workspace_roots  → session_cwd (first entry)
#   transcript_path  → transcript_path
#   model, cursor_version, generation_id → _cursor metadata
# =============================================================================

set -euo pipefail

# Get the directory of this script and source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Override session source before sourcing common.sh
export AGENTSLEAK_SESSION_SOURCE="cursor"

source "${SCRIPT_DIR}/common.sh"

# -----------------------------------------------------------------------------
# Cursor → AgentsLeak Translation
# -----------------------------------------------------------------------------

# Translate a Cursor hook payload into AgentsLeak HookPayload format.
# Reads Cursor JSON from $1, outputs AgentsLeak-formatted JSON to stdout.
translate_payload() {
    local cursor_json="$1"
    local event_name="$2"

    case "$event_name" in
        sessionStart)
            echo "$cursor_json" | jq \
                '{
                    session_id: (.session_id // .conversation_id // "cursor-unknown"),
                    hook_type: "SessionStart",
                    session_cwd: (.workspace_roots[0] // null),
                    session_source: "cursor",
                    transcript_path: (.transcript_path // null),
                    endpoint_user: (.user_email // null),
                    _cursor: {
                        is_background_agent: (.is_background_agent // null),
                        composer_mode: (.composer_mode // null),
                        model: (.model // null),
                        cursor_version: (.cursor_version // null),
                        generation_id: (.generation_id // null)
                    }
                }' 2>/dev/null
            ;;
        sessionEnd)
            echo "$cursor_json" | jq \
                '{
                    session_id: (.session_id // .conversation_id // "cursor-unknown"),
                    hook_type: "SessionEnd",
                    session_cwd: (.workspace_roots[0] // null),
                    session_source: "cursor",
                    _cursor: {
                        reason: (.reason // null),
                        duration_ms: (.duration_ms // null),
                        final_status: (.final_status // null),
                        error_message: (.error_message // null),
                        is_background_agent: (.is_background_agent // null),
                        model: (.model // null),
                        cursor_version: (.cursor_version // null)
                    }
                }' 2>/dev/null
            ;;
        preToolUse)
            echo "$cursor_json" | jq \
                '{
                    session_id: (.conversation_id // "cursor-unknown"),
                    hook_type: "PreToolUse",
                    tool_name: (.tool_name // "unknown"),
                    tool_input: (.tool_input // {}),
                    tool_use_id: (.tool_use_id // null),
                    session_cwd: (.cwd // .workspace_roots[0] // null),
                    session_source: "cursor",
                    transcript_path: (.transcript_path // null),
                    endpoint_user: (.user_email // null)
                }' 2>/dev/null
            ;;
        postToolUse)
            echo "$cursor_json" | jq \
                '{
                    session_id: (.conversation_id // "cursor-unknown"),
                    hook_type: "PostToolUse",
                    tool_name: (.tool_name // "unknown"),
                    tool_input: (.tool_input // {}),
                    tool_result: { output: (.tool_output // null) },
                    tool_use_id: (.tool_use_id // null),
                    session_cwd: (.cwd // .workspace_roots[0] // null),
                    session_source: "cursor",
                    _cursor: {
                        duration_ms: (.duration // null)
                    }
                }' 2>/dev/null
            ;;
        postToolUseFailure)
            echo "$cursor_json" | jq \
                '{
                    session_id: (.conversation_id // "cursor-unknown"),
                    hook_type: "PostToolUseFailure",
                    tool_name: (.tool_name // "unknown"),
                    tool_input: (.tool_input // {}),
                    tool_result: { error: (.error_message // null) },
                    tool_use_id: (.tool_use_id // null),
                    session_cwd: (.cwd // .workspace_roots[0] // null),
                    session_source: "cursor",
                    _cursor: {
                        failure_type: (.failure_type // null),
                        duration_ms: (.duration // null),
                        is_interrupt: (.is_interrupt // null)
                    }
                }' 2>/dev/null
            ;;
        subagentStart)
            echo "$cursor_json" | jq \
                --arg ts "$(date +%s)" \
                '{
                    session_id: ("cursor-sub-" + (.conversation_id // "unknown") + "-" + $ts),
                    hook_type: "SubagentStart",
                    parent_session_id: (.conversation_id // "cursor-unknown"),
                    session_cwd: (.workspace_roots[0] // null),
                    session_source: "cursor",
                    _cursor: {
                        subagent_type: (.subagent_type // null),
                        prompt: (.prompt // null),
                        model: (.model // null)
                    }
                }' 2>/dev/null
            ;;
        subagentStop)
            echo "$cursor_json" | jq \
                '{
                    session_id: (.conversation_id // "cursor-unknown"),
                    hook_type: "SubagentStop",
                    session_source: "cursor",
                    _cursor: {
                        subagent_type: (.subagent_type // null),
                        status: (.status // null),
                        result: (.result // null),
                        duration_ms: (.duration // null),
                        agent_transcript_path: (.agent_transcript_path // null)
                    }
                }' 2>/dev/null
            ;;
        beforeSubmitPrompt)
            echo "$cursor_json" | jq \
                '{
                    session_id: (.conversation_id // "cursor-unknown"),
                    hook_type: "UserPromptSubmit",
                    query: (.prompt // null),
                    session_cwd: (.workspace_roots[0] // null),
                    session_source: "cursor",
                    transcript_path: (.transcript_path // null),
                    endpoint_user: (.user_email // null)
                }' 2>/dev/null
            ;;
        stop)
            echo "$cursor_json" | jq \
                '{
                    session_id: (.conversation_id // "cursor-unknown"),
                    hook_type: "SessionEnd",
                    session_cwd: (.workspace_roots[0] // null),
                    session_source: "cursor",
                    _cursor: {
                        status: (.status // null),
                        loop_count: (.loop_count // null)
                    }
                }' 2>/dev/null
            ;;
        *)
            log_error "Unknown Cursor event: $event_name"
            return 1
            ;;
    esac
}

# Translate AgentsLeak's response back to Cursor's expected format.
# Each hook type has a different expected response shape.
translate_response() {
    local response="$1"
    local event_name="$2"

    # Empty or null response → safe default per event type (fail-open)
    if [[ -z "$response" || "$response" == "{}" || "$response" == "null" ]]; then
        case "$event_name" in
            preToolUse)         echo '{"decision":"allow"}' ;;
            sessionStart)       echo '{"continue":true}' ;;
            subagentStart)      echo '{"decision":"allow"}' ;;
            beforeSubmitPrompt) echo '{"continue":true}' ;;
            stop)               echo '{}' ;;
            subagentStop)       echo '{}' ;;
            *)                  echo '{}' ;;
        esac
        return 0
    fi

    case "$event_name" in
        preToolUse)
            # Backend returns: {hookSpecificOutput: {permissionDecision: "deny", ...}}
            # Cursor expects:  {decision: "allow"|"deny", reason: "...", updated_input: {...}}
            local decision
            decision=$(echo "$response" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)

            if [[ "$decision" == "deny" ]]; then
                local reason
                reason=$(echo "$response" | jq -r '.hookSpecificOutput.permissionDecisionReason // "Blocked by AgentsLeak policy"' 2>/dev/null)
                jq -n --arg reason "$reason" '{"decision":"deny","reason":$reason}'
            else
                # Check for modified input
                local has_updated
                has_updated=$(echo "$response" | jq -r '.hookSpecificOutput.updatedInput // empty' 2>/dev/null)
                if [[ -n "$has_updated" && "$has_updated" != "null" ]]; then
                    echo "$response" | jq '{"decision":"allow","updated_input":.hookSpecificOutput.updatedInput}' 2>/dev/null
                else
                    echo '{"decision":"allow"}'
                fi
            fi
            ;;
        sessionStart)
            # Cursor expects: {continue: true|false, user_message: "..."}
            echo '{"continue":true}'
            ;;
        subagentStart)
            # Cursor expects: {decision: "allow"|"deny", reason: "..."}
            echo '{"decision":"allow"}'
            ;;
        beforeSubmitPrompt)
            # Cursor expects: {continue: true|false, user_message: "..."}
            echo '{"continue":true}'
            ;;
        stop)
            # Cursor expects: {followup_message: "..."}
            echo '{}'
            ;;
        subagentStop)
            # Cursor expects: {followup_message: "..."}
            echo '{}'
            ;;
        *)
            echo '{}'
            ;;
    esac
}

# -----------------------------------------------------------------------------
# Routing
# -----------------------------------------------------------------------------

# Get the collector endpoint for a Cursor event.
get_endpoint() {
    local event_name="$1"
    case "$event_name" in
        sessionStart)        echo "/api/collect/session-start" ;;
        sessionEnd)          echo "/api/collect/session-end" ;;
        preToolUse)          echo "/api/collect/pre-tool-use" ;;
        postToolUse)         echo "/api/collect/post-tool-use" ;;
        postToolUseFailure)  echo "/api/collect/post-tool-use-error" ;;
        subagentStart)       echo "/api/collect/subagent-start" ;;
        subagentStop)        echo "/api/collect/subagent-stop" ;;
        beforeSubmitPrompt)  echo "/api/collect/user-prompt-submit" ;;
        stop)                echo "/api/collect/session-end" ;;
        *)                   echo "" ;;
    esac
}

# Check if an event is synchronous (Cursor waits for response).
is_sync_event() {
    local event_name="$1"
    case "$event_name" in
        preToolUse|sessionStart|subagentStart|beforeSubmitPrompt|stop|subagentStop)
            return 0
            ;;
        sessionEnd|postToolUse|postToolUseFailure)
            return 1
            ;;
        *)
            return 1
            ;;
    esac
}

# -----------------------------------------------------------------------------
# Main Logic
# -----------------------------------------------------------------------------

main() {
    # Read Cursor's JSON payload from stdin
    local cursor_json
    cursor_json=$(cat)

    # Quick validation
    if [[ -z "$cursor_json" || "$cursor_json" == "{}" ]]; then
        log_debug "Empty input, exiting"
        exit 0
    fi

    # Detect event type from the payload
    local event_name
    if ! command_exists jq; then
        log_error "jq is required for Cursor hook processing"
        exit 0
    fi

    event_name=$(echo "$cursor_json" | jq -r '.hook_event_name // empty' 2>/dev/null)

    if [[ -z "$event_name" ]]; then
        log_error "No hook_event_name in Cursor payload"
        exit 0
    fi

    log_debug "Cursor event: $event_name"

    # Extract Cursor user_email to enrich endpoint headers
    local cursor_user_email
    cursor_user_email=$(echo "$cursor_json" | jq -r '.user_email // empty' 2>/dev/null)
    if [[ -n "$cursor_user_email" ]]; then
        export AGENTSLEAK_USER="$cursor_user_email"
    fi

    # Get the collector endpoint
    local endpoint
    endpoint=$(get_endpoint "$event_name")

    if [[ -z "$endpoint" ]]; then
        log_error "No endpoint mapping for event: $event_name"
        exit 0
    fi

    # Translate Cursor payload → AgentsLeak format
    local agentsleak_json
    agentsleak_json=$(translate_payload "$cursor_json" "$event_name")

    if [[ -z "$agentsleak_json" ]]; then
        log_error "Failed to translate payload for event: $event_name"
        exit 0
    fi

    # Enrich with metadata
    local enriched_json
    enriched_json=$(enrich_payload "$agentsleak_json")

    log_debug "Sending to $endpoint"

    # Route: sync events wait for response, async events fire-and-forget
    if is_sync_event "$event_name"; then
        local response
        if response=$(send_to_collector "$endpoint" "$enriched_json" "$AGENTSLEAK_SYNC_TIMEOUT"); then
            log_debug "Collector responded: ${response:0:200}"

            # Translate response to Cursor format and output
            if [[ -n "$response" && "$response" != "null" ]]; then
                translate_response "$response" "$event_name"
            else
                translate_response "" "$event_name"
            fi
        else
            # Collector unavailable - fail open with correct format
            log_debug "Collector unavailable, failing open"
            translate_response "" "$event_name"
        fi
    else
        # Async events: fire-and-forget, no output
        send_to_collector_async "$endpoint" "$enriched_json"
        log_debug "Async event sent: $event_name"
    fi

    exit 0
}

# Run main function
main "$@"
