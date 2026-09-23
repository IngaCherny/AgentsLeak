#!/bin/bash
# =============================================================================
# AgentsLeak - Universal Gemini CLI Hook Adapter
# =============================================================================
# Single entry point for all Gemini CLI hook events.
# Translates Gemini CLI's JSON format -> AgentsLeak HookPayload format,
# routes to the correct collector endpoint, and translates the response
# back to Gemini CLI's expected format.
#
# Based on the published Gemini CLI hooks reference (geminicli.com/docs/hooks).
# Gemini CLI's hook config schema and stdin payload shape are close cousins of
# Claude Code's own hook spec (matcher + hooks[] with type/command, JSON on
# stdin/stdout, exit code semantics) — this adapter follows the same
# translate -> route -> translate-back pattern as cursor-hook.sh.
#
# Gemini CLI events wired to AgentsLeak (6 of the 11 documented events):
#   SessionStart  -> /api/collect/session-start       (sync, advisory only)
#   SessionEnd    -> /api/collect/session-end          (async)
#   BeforeTool    -> /api/collect/pre-tool-use         (sync, can block)
#   AfterTool     -> /api/collect/post-tool-use        (async)
#   BeforeAgent   -> /api/collect/user-prompt-submit   (sync, has `prompt`)
#   PreCompress   -> /api/collect/pre-compact           (async)
#   Notification  -> /api/collect/permission-request   (async, best-effort match —
#                     Gemini's ToolPermission notification is the closest analog
#                     to Claude Code's PermissionRequest, tagged under _gemini
#                     so it's never conflated with a real approve/deny decision)
#
# Deliberately NOT wired (no safe 1:1 equivalent in AgentsLeak's collector):
#   AfterAgent, BeforeModel, AfterModel, BeforeToolSelection
#   AgentsLeak has no model-request-level endpoint, and AfterAgent fires once
#   per agent-loop turn rather than once per session — routing it to
#   session-end would call db.end_session() mid-session and corrupt session
#   state. Leaving these unwired is safer than a wrong mapping.
#
# NOTE: this adapter was built from Gemini CLI's published docs, not a live
# install. Verify the exact matcher/response schema against your installed
# Gemini CLI version before relying on blocking behavior in production.
# =============================================================================

set -euo pipefail

# Get the directory of this script and source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Override session source before sourcing common.sh
export AGENTSLEAK_SESSION_SOURCE="gemini"

source "${SCRIPT_DIR}/common.sh"

# -----------------------------------------------------------------------------
# Gemini CLI -> AgentsLeak Translation
# -----------------------------------------------------------------------------

# Translate a Gemini CLI hook payload into AgentsLeak HookPayload format.
# Reads Gemini CLI JSON from $1, outputs AgentsLeak-formatted JSON to stdout.
translate_payload() {
    local gemini_json="$1"
    local event_name="$2"

    case "$event_name" in
        SessionStart)
            echo "$gemini_json" | jq \
                '{
                    session_id: (.session_id // "gemini-unknown"),
                    hook_type: "SessionStart",
                    session_cwd: (.cwd // null),
                    session_source: "gemini",
                    transcript_path: (.transcript_path // null),
                    _gemini: {
                        source: (.source // null)
                    }
                }' 2>/dev/null
            ;;
        SessionEnd)
            echo "$gemini_json" | jq \
                '{
                    session_id: (.session_id // "gemini-unknown"),
                    hook_type: "SessionEnd",
                    session_cwd: (.cwd // null),
                    session_source: "gemini",
                    _gemini: {
                        reason: (.reason // null)
                    }
                }' 2>/dev/null
            ;;
        BeforeTool)
            echo "$gemini_json" | jq \
                '{
                    session_id: (.session_id // "gemini-unknown"),
                    hook_type: "PreToolUse",
                    tool_name: (.tool_name // "unknown"),
                    tool_input: (.tool_input // {}),
                    session_cwd: (.cwd // null),
                    session_source: "gemini",
                    transcript_path: (.transcript_path // null),
                    _gemini: {
                        mcp_context: (.mcp_context // null),
                        original_request_name: (.original_request_name // null)
                    }
                }' 2>/dev/null
            ;;
        AfterTool)
            echo "$gemini_json" | jq \
                '{
                    session_id: (.session_id // "gemini-unknown"),
                    hook_type: "PostToolUse",
                    tool_name: (.tool_name // "unknown"),
                    tool_input: (.tool_input // {}),
                    tool_result: { output: (.tool_response // null) },
                    session_cwd: (.cwd // null),
                    session_source: "gemini",
                    _gemini: {
                        mcp_context: (.mcp_context // null),
                        original_request_name: (.original_request_name // null)
                    }
                }' 2>/dev/null
            ;;
        BeforeAgent)
            echo "$gemini_json" | jq \
                '{
                    session_id: (.session_id // "gemini-unknown"),
                    hook_type: "UserPromptSubmit",
                    query: (.prompt // null),
                    session_cwd: (.cwd // null),
                    session_source: "gemini",
                    transcript_path: (.transcript_path // null)
                }' 2>/dev/null
            ;;
        PreCompress)
            echo "$gemini_json" | jq \
                '{
                    session_id: (.session_id // "gemini-unknown"),
                    hook_type: "PreCompact",
                    session_cwd: (.cwd // null),
                    session_source: "gemini",
                    _gemini: {
                        trigger: (.trigger // null)
                    }
                }' 2>/dev/null
            ;;
        Notification)
            echo "$gemini_json" | jq \
                '{
                    session_id: (.session_id // "gemini-unknown"),
                    hook_type: "PermissionRequest",
                    session_cwd: (.cwd // null),
                    session_source: "gemini",
                    _gemini: {
                        notification_type: (.notification_type // null),
                        message: (.message // null),
                        details: (.details // null)
                    }
                }' 2>/dev/null
            ;;
        *)
            log_error "Unknown or unwired Gemini CLI event: $event_name"
            return 1
            ;;
    esac
}

# Translate AgentsLeak's response back to Gemini CLI's expected format.
# Only BeforeTool carries real blocking semantics today — every other wired
# event's collector endpoint always acks with {"status": "received"} and
# never returns a decision, so their translation is intentionally a no-op.
translate_response() {
    local response="$1"
    local event_name="$2"

    case "$event_name" in
        BeforeTool)
            # Empty/null response -> allow (fail-open)
            if [[ -z "$response" || "$response" == "{}" || "$response" == "null" ]]; then
                echo '{"decision":"allow"}'
                return 0
            fi

            # Backend returns: {hookSpecificOutput: {permissionDecision: "deny", ...}}
            # Gemini CLI expects: {decision: "allow"|"deny", reason: "...", hookSpecificOutput: {tool_input: {...}}}
            local decision
            decision=$(echo "$response" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)

            if [[ "$decision" == "deny" ]]; then
                local reason
                reason=$(echo "$response" | jq -r '.hookSpecificOutput.permissionDecisionReason // "Blocked by AgentsLeak policy"' 2>/dev/null)
                jq -n --arg reason "$reason" '{"decision":"deny","reason":$reason}'
            else
                echo '{"decision":"allow"}'
            fi
            ;;
        *)
            # Advisory-only events: no output needed.
            echo '{}'
            ;;
    esac
}

# -----------------------------------------------------------------------------
# Routing
# -----------------------------------------------------------------------------

# Get the collector endpoint for a Gemini CLI event.
get_endpoint() {
    local event_name="$1"
    case "$event_name" in
        SessionStart)   echo "/api/collect/session-start" ;;
        SessionEnd)     echo "/api/collect/session-end" ;;
        BeforeTool)     echo "/api/collect/pre-tool-use" ;;
        AfterTool)      echo "/api/collect/post-tool-use" ;;
        BeforeAgent)    echo "/api/collect/user-prompt-submit" ;;
        PreCompress)    echo "/api/collect/pre-compact" ;;
        Notification)   echo "/api/collect/permission-request" ;;
        *)              echo "" ;;
    esac
}

# Check if an event is synchronous (Gemini CLI waits for response).
is_sync_event() {
    local event_name="$1"
    case "$event_name" in
        BeforeTool|SessionStart|BeforeAgent)
            return 0
            ;;
        SessionEnd|AfterTool|PreCompress|Notification)
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
    # Read Gemini CLI's JSON payload from stdin
    local gemini_json
    gemini_json=$(cat)

    # Quick validation
    if [[ -z "$gemini_json" || "$gemini_json" == "{}" ]]; then
        log_debug "Empty input, exiting"
        exit 0
    fi

    if ! command_exists jq; then
        log_error "jq is required for Gemini CLI hook processing"
        exit 0
    fi

    # Detect event type from the payload
    local event_name
    event_name=$(echo "$gemini_json" | jq -r '.hook_event_name // empty' 2>/dev/null)

    if [[ -z "$event_name" ]]; then
        log_error "No hook_event_name in Gemini CLI payload"
        exit 0
    fi

    log_debug "Gemini CLI event: $event_name"

    # Get the collector endpoint
    local endpoint
    endpoint=$(get_endpoint "$event_name")

    if [[ -z "$endpoint" ]]; then
        log_debug "No endpoint mapping for event: $event_name (not wired, skipping)"
        exit 0
    fi

    # Translate Gemini CLI payload -> AgentsLeak format
    local agentsleak_json
    agentsleak_json=$(translate_payload "$gemini_json" "$event_name")

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
            translate_response "$response" "$event_name"
        else
            log_debug "Collector unavailable, failing open"
            translate_response "" "$event_name"
        fi
    else
        send_to_collector_async "$endpoint" "$enriched_json"
        log_debug "Async event sent: $event_name"
    fi

    exit 0
}

main "$@"
