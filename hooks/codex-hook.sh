#!/bin/bash
# =============================================================================
# AgentsLeak - Universal Codex CLI Hook Adapter
# =============================================================================
# Single entry point for all Codex CLI hook events.
# Translates Codex CLI's JSON format -> AgentsLeak HookPayload format,
# routes to the correct collector endpoint, and translates the response
# back to Codex CLI's expected format.
#
# Based on the published Codex CLI hooks reference (developers.openai.com/codex/hooks).
# Codex's hook config schema and stdin/stdout contract are the closest match of
# any agent AgentsLeak integrates with: matcher + hooks[] with type/command in
# hooks.json, PreToolUse's hookSpecificOutput.permissionDecision/updatedInput —
# same field names as Claude Code's own hook spec, which is exactly what
# AgentsLeak's Decision.to_hook_response() already emits (see
# agentsleak/models/events.py). That's why PreToolUse translation below is a
# near pass-through rather than a reshape.
#
# Codex CLI events wired to AgentsLeak (mirroring which events Claude Code's own
# install.sh wires — see hooks/install.sh):
#   SessionStart      -> /api/collect/session-start       (async)
#   SessionEnd        -> /api/collect/session-end          (async)
#   PreToolUse        -> /api/collect/pre-tool-use         (sync, can block)
#   PostToolUse       -> /api/collect/post-tool-use        (async)
#   PermissionRequest -> /api/collect/permission-request   (sync — Codex's
#                         PermissionRequest is the same approve/deny-prompt
#                         concept as Claude Code's, not a best-effort guess)
#   PreCompact        -> /api/collect/pre-compact           (async)
#   UserPromptSubmit  -> /api/collect/user-prompt-submit   (async)
#   SubagentStart     -> /api/collect/subagent-start       (async)
#   SubagentStop      -> /api/collect/subagent-stop        (async)
#   Stop              -> /api/collect/stop                 (async — the turn's
#                         reply, from last_assistant_message; answers {})
#
# Deliberately NOT wired:
#   PostCompact, Interrupt — Claude Code's own install.sh doesn't wire
#   PostCompact either, and Interrupt has no equivalent lifecycle concept in
#   AgentsLeak's data model.
#
# NOTE: this adapter was built from Codex CLI's published docs, not a live
# install. Codex requires reviewing/trusting a hook definition before it runs
# (the `/hooks` command, or `--dangerously-bypass-hook-trust` for automation) —
# expect to approve this script's hooks once after install. Verify the exact
# payload/response schema against your installed Codex CLI version before
# relying on blocking behavior in production.
# =============================================================================

set -euo pipefail

# Get the directory of this script and source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Override session source before sourcing common.sh
export AGENTSLEAK_SESSION_SOURCE="codex"

source "${SCRIPT_DIR}/common.sh"

# -----------------------------------------------------------------------------
# Codex CLI -> AgentsLeak Translation
# -----------------------------------------------------------------------------

# Translate a Codex CLI hook payload into AgentsLeak HookPayload format.
# Reads Codex CLI JSON from $1, outputs AgentsLeak-formatted JSON to stdout.
translate_payload() {
    local codex_json="$1"
    local event_name="$2"

    case "$event_name" in
        SessionStart)
            echo "$codex_json" | jq \
                '{
                    session_id: (.session_id // "codex-unknown"),
                    hook_type: "SessionStart",
                    session_cwd: (.cwd // null),
                    session_source: "codex",
                    transcript_path: (.transcript_path // null),
                    _codex: {
                        source: (.source // null),
                        model: (.model // null)
                    }
                }' 2>/dev/null
            ;;
        SessionEnd)
            echo "$codex_json" | jq \
                '{
                    session_id: (.session_id // "codex-unknown"),
                    hook_type: "SessionEnd",
                    session_cwd: (.cwd // null),
                    session_source: "codex"
                }' 2>/dev/null
            ;;
        PreToolUse)
            echo "$codex_json" | jq \
                '{
                    session_id: (.session_id // "codex-unknown"),
                    hook_type: "PreToolUse",
                    tool_name: (.tool_name // "unknown"),
                    tool_input: (.tool_input // {}),
                    tool_use_id: (.tool_use_id // null),
                    session_cwd: (.cwd // null),
                    session_source: "codex",
                    transcript_path: (.transcript_path // null),
                    _codex: {
                        turn_id: (.turn_id // null),
                        model: (.model // null),
                        permission_mode: (.permission_mode // null)
                    }
                }' 2>/dev/null
            ;;
        PostToolUse)
            echo "$codex_json" | jq \
                '{
                    session_id: (.session_id // "codex-unknown"),
                    hook_type: "PostToolUse",
                    tool_name: (.tool_name // "unknown"),
                    tool_input: (.tool_input // {}),
                    tool_result: (.tool_response // null),
                    tool_use_id: (.tool_use_id // null),
                    session_cwd: (.cwd // null),
                    session_source: "codex",
                    _codex: {
                        turn_id: (.turn_id // null)
                    }
                }' 2>/dev/null
            ;;
        PermissionRequest)
            echo "$codex_json" | jq \
                '{
                    session_id: (.session_id // "codex-unknown"),
                    hook_type: "PermissionRequest",
                    tool_name: (.tool_name // "unknown"),
                    tool_input: (.tool_input // {}),
                    session_cwd: (.cwd // null),
                    session_source: "codex"
                }' 2>/dev/null
            ;;
        PreCompact)
            echo "$codex_json" | jq \
                '{
                    session_id: (.session_id // "codex-unknown"),
                    hook_type: "PreCompact",
                    session_cwd: (.cwd // null),
                    session_source: "codex"
                }' 2>/dev/null
            ;;
        UserPromptSubmit)
            echo "$codex_json" | jq \
                '{
                    session_id: (.session_id // "codex-unknown"),
                    hook_type: "UserPromptSubmit",
                    query: (.prompt // null),
                    session_cwd: (.cwd // null),
                    session_source: "codex",
                    transcript_path: (.transcript_path // null),
                    _codex: {
                        turn_id: (.turn_id // null)
                    }
                }' 2>/dev/null
            ;;
        SubagentStart)
            echo "$codex_json" | jq \
                '{
                    session_id: (.session_id // "codex-unknown"),
                    hook_type: "SubagentStart",
                    session_cwd: (.cwd // null),
                    session_source: "codex"
                }' 2>/dev/null
            ;;
        SubagentStop)
            echo "$codex_json" | jq \
                '{
                    session_id: (.session_id // "codex-unknown"),
                    hook_type: "SubagentStop",
                    session_cwd: (.cwd // null),
                    session_source: "codex",
                    _codex: {
                        last_assistant_message: (.last_assistant_message // null)
                    }
                }' 2>/dev/null
            ;;
        Stop)
            echo "$codex_json" | jq \
                '{
                    session_id: (.session_id // "codex-unknown"),
                    hook_type: "Stop",
                    reply: (.last_assistant_message // null),
                    session_cwd: (.cwd // null),
                    session_source: "codex",
                    transcript_path: (.transcript_path // null),
                    _codex: {
                        turn_id: (.turn_id // null),
                        stop_hook_active: (.stop_hook_active // null)
                    }
                }' 2>/dev/null
            ;;
        *)
            log_error "Unknown or unwired Codex CLI event: $event_name"
            return 1
            ;;
    esac
}

# Translate AgentsLeak's response back to Codex CLI's expected format.
# PreToolUse is a near pass-through: AgentsLeak's Decision.to_hook_response()
# already emits Codex's exact hookSpecificOutput shape (permissionDecision,
# permissionDecisionReason, updatedInput). Every other wired event's collector
# endpoint always acks with {"status": "received"} and never returns a
# decision, so their translation is intentionally a no-op.
translate_response() {
    local response="$1"
    local event_name="$2"

    case "$event_name" in
        PreToolUse)
            if [[ -z "$response" || "$response" == "null" ]]; then
                echo '{}'
            else
                echo "$response"
            fi
            ;;
        PermissionRequest)
            # Backend returns: {hookSpecificOutput: {permissionDecision, permissionDecisionReason}}
            # Codex expects:   {hookSpecificOutput: {decision: {behavior: "allow"|"deny", message}}}
            if [[ -z "$response" || "$response" == "{}" || "$response" == "null" ]]; then
                echo '{"hookSpecificOutput":{"decision":{"behavior":"allow"}}}'
                return 0
            fi
            local decision
            decision=$(echo "$response" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)
            if [[ "$decision" == "deny" ]]; then
                local reason
                reason=$(echo "$response" | jq -r '.hookSpecificOutput.permissionDecisionReason // "Blocked by AgentsLeak policy"' 2>/dev/null)
                jq -n --arg msg "$reason" '{"hookSpecificOutput":{"decision":{"behavior":"deny","message":$msg}}}'
            else
                echo '{"hookSpecificOutput":{"decision":{"behavior":"allow"}}}'
            fi
            ;;
        *)
            echo '{}'
            ;;
    esac
}

# -----------------------------------------------------------------------------
# Routing
# -----------------------------------------------------------------------------

# Get the collector endpoint for a Codex CLI event.
get_endpoint() {
    local event_name="$1"
    case "$event_name" in
        SessionStart)       echo "/api/collect/session-start" ;;
        SessionEnd)         echo "/api/collect/session-end" ;;
        PreToolUse)         echo "/api/collect/pre-tool-use" ;;
        PostToolUse)        echo "/api/collect/post-tool-use" ;;
        PermissionRequest)  echo "/api/collect/permission-request" ;;
        PreCompact)         echo "/api/collect/pre-compact" ;;
        UserPromptSubmit)   echo "/api/collect/user-prompt-submit" ;;
        SubagentStart)      echo "/api/collect/subagent-start" ;;
        SubagentStop)       echo "/api/collect/subagent-stop" ;;
        Stop)               echo "/api/collect/stop" ;;
        *)                  echo "" ;;
    esac
}

# Check if an event is synchronous (Codex CLI waits for response).
# Mirrors exactly which of Claude Code's own hook scripts are sync vs
# fire-and-forget (see hooks/pre-tool-use.sh and hooks/permission-request.sh
# vs the rest) — Codex's payload/semantics are close enough to reuse the
# same choices rather than inventing new ones.
is_sync_event() {
    local event_name="$1"
    case "$event_name" in
        PreToolUse|PermissionRequest)
            return 0
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
    # Read Codex CLI's JSON payload from stdin
    local codex_json
    codex_json=$(cat)

    # Quick validation
    if [[ -z "$codex_json" || "$codex_json" == "{}" ]]; then
        log_debug "Empty input, exiting"
        exit 0
    fi

    if ! command_exists jq; then
        log_error "jq is required for Codex CLI hook processing"
        exit 0
    fi

    # Detect event type from the payload
    local event_name
    event_name=$(echo "$codex_json" | jq -r '.hook_event_name // empty' 2>/dev/null)

    if [[ -z "$event_name" ]]; then
        log_error "No hook_event_name in Codex CLI payload"
        exit 0
    fi

    log_debug "Codex CLI event: $event_name"

    # Get the collector endpoint
    local endpoint
    endpoint=$(get_endpoint "$event_name")

    if [[ -z "$endpoint" ]]; then
        log_debug "No endpoint mapping for event: $event_name (not wired, skipping)"
        exit 0
    fi

    # Translate Codex CLI payload -> AgentsLeak format
    local agentsleak_json
    agentsleak_json=$(translate_payload "$codex_json" "$event_name")

    if [[ -z "$agentsleak_json" ]]; then
        log_error "Failed to translate payload for event: $event_name"
        exit 0
    fi

    if [[ "$event_name" == "Stop" ]]; then
        agentsleak_json=$(apply_reply_capture "$agentsleak_json")
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
        # Codex expects JSON on stdout from Stop; {} lets the turn end.
        if [[ "$event_name" == "Stop" ]]; then
            echo '{}'
        fi
    fi

    exit 0
}

main "$@"
