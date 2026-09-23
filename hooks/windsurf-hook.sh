#!/bin/bash
# =============================================================================
# AgentsLeak - Universal Windsurf (Cascade) Hook Adapter
# =============================================================================
# Single entry point for all Windsurf Cascade hook events.
# Translates Cascade's JSON format -> AgentsLeak HookPayload format, routes to
# the correct collector endpoint, and blocks/allows via Cascade's protocol.
#
# Based on the published Cascade hooks reference (docs.windsurf.com/windsurf/cascade/hooks,
# now mirrored under docs.devin.ai/desktop/cascade/hooks — Windsurf was folded into
# Cognition's "Devin Desktop" product; both the "Windsurf" and "Devin Desktop"
# names and hooks.json paths are still recognized).
#
# IMPORTANT PROTOCOL DIFFERENCE from cursor-hook.sh / gemini-hook.sh / codex-hook.sh:
# Cascade does NOT read a JSON decision from stdout. Only pre-hooks can block,
# and only via exit code: exit 0 = allow, exit 2 = block (with the reason on
# stderr), any other exit code = ignored (action proceeds). Post-hooks cannot
# block at all — the action has already happened by the time they run.
#
# Cascade also has no SessionStart/SessionEnd hook events at all (unlike Claude
# Code, Cursor, Gemini CLI, and Codex CLI, which all expose session lifecycle
# hooks) — AgentsLeak sessions for Windsurf are created lazily on the first
# tool-use event via the collector's own _create_or_update_session(), same as
# it already does when any hook fires before a session record exists.
#
# Cascade hook events wired to AgentsLeak (9 of its 12 documented events):
#   pre_read_code    -> /api/collect/pre-tool-use         (sync, can block)
#   pre_write_code   -> /api/collect/pre-tool-use         (sync, can block)
#   pre_run_command  -> /api/collect/pre-tool-use         (sync, can block)
#   pre_mcp_tool_use -> /api/collect/pre-tool-use         (sync, can block)
#   pre_user_prompt  -> /api/collect/user-prompt-submit   (sync — backend never
#                        denies prompts today, so this never actually blocks,
#                        kept sync only for architectural symmetry with the
#                        other pre_* hooks)
#   post_read_code   -> /api/collect/post-tool-use        (async)
#   post_write_code  -> /api/collect/post-tool-use        (async)
#   post_run_command -> /api/collect/post-tool-use        (async)
#   post_mcp_tool_use-> /api/collect/post-tool-use        (async)
#
# Deliberately NOT wired: post_cascade_response, post_cascade_response_with_transcript,
# post_setup_worktree — none has a matching session/tool-lifecycle concept in
# AgentsLeak's collector (same reasoning as skipping Gemini's AfterAgent).
#
# session_cwd availability is uneven across events: Cascade's stdin payload
# only includes a cwd field for pre/post_run_command's tool_info — file
# read/write and MCP tool_info carry no cwd at all. Sessions created from
# those events will have a null cwd until a run_command event supplies one.
#
# NOTE: this adapter was built from Cascade's published docs, not a live
# install. Verify the exact tool_info schema against your installed Windsurf/
# Devin Desktop version before relying on blocking behavior in production.
# =============================================================================

set -euo pipefail

# Get the directory of this script and source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Override session source before sourcing common.sh
export AGENTSLEAK_SESSION_SOURCE="windsurf"

source "${SCRIPT_DIR}/common.sh"

# -----------------------------------------------------------------------------
# Cascade -> AgentsLeak Translation
# -----------------------------------------------------------------------------

# Translate a Cascade hook payload into AgentsLeak HookPayload format.
# Reads Cascade JSON from $1, outputs AgentsLeak-formatted JSON to stdout.
translate_payload() {
    local cascade_json="$1"
    local event_name="$2"

    case "$event_name" in
        pre_read_code|post_read_code)
            echo "$cascade_json" | jq --arg ht "$([[ "$event_name" == pre_* ]] && echo PreToolUse || echo PostToolUse)" \
                '{
                    session_id: (.trajectory_id // "windsurf-unknown"),
                    hook_type: $ht,
                    tool_name: "read_code",
                    tool_input: { file_path: (.tool_info.file_path // null) },
                    session_source: "windsurf",
                    _windsurf: {
                        execution_id: (.execution_id // null),
                        model_name: (.model_name // null)
                    }
                }' 2>/dev/null
            ;;
        pre_write_code|post_write_code)
            echo "$cascade_json" | jq --arg ht "$([[ "$event_name" == pre_* ]] && echo PreToolUse || echo PostToolUse)" \
                '{
                    session_id: (.trajectory_id // "windsurf-unknown"),
                    hook_type: $ht,
                    tool_name: "write_code",
                    tool_input: { file_path: (.tool_info.file_path // null), edits: (.tool_info.edits // null) },
                    session_source: "windsurf",
                    _windsurf: {
                        execution_id: (.execution_id // null),
                        model_name: (.model_name // null)
                    }
                }' 2>/dev/null
            ;;
        pre_run_command|post_run_command)
            echo "$cascade_json" | jq --arg ht "$([[ "$event_name" == pre_* ]] && echo PreToolUse || echo PostToolUse)" \
                '{
                    session_id: (.trajectory_id // "windsurf-unknown"),
                    hook_type: $ht,
                    tool_name: "run_command",
                    tool_input: { command: (.tool_info.command_line // null) },
                    session_cwd: (.tool_info.cwd // null),
                    session_source: "windsurf",
                    _windsurf: {
                        execution_id: (.execution_id // null),
                        model_name: (.model_name // null)
                    }
                }' 2>/dev/null
            ;;
        pre_mcp_tool_use|post_mcp_tool_use)
            echo "$cascade_json" | jq --arg ht "$([[ "$event_name" == pre_* ]] && echo PreToolUse || echo PostToolUse)" \
                '{
                    session_id: (.trajectory_id // "windsurf-unknown"),
                    hook_type: $ht,
                    tool_name: (.tool_info.mcp_tool_name // "unknown"),
                    tool_input: (.tool_info.mcp_tool_arguments // {}),
                    tool_result: (if .tool_info.mcp_result then { output: .tool_info.mcp_result } else null end),
                    session_source: "windsurf",
                    _windsurf: {
                        mcp_server_name: (.tool_info.mcp_server_name // null),
                        execution_id: (.execution_id // null)
                    }
                }' 2>/dev/null
            ;;
        pre_user_prompt)
            echo "$cascade_json" | jq \
                '{
                    session_id: (.trajectory_id // "windsurf-unknown"),
                    hook_type: "UserPromptSubmit",
                    query: (.tool_info.user_prompt // null),
                    session_source: "windsurf"
                }' 2>/dev/null
            ;;
        *)
            log_error "Unknown or unwired Cascade event: $event_name"
            return 1
            ;;
    esac
}

# -----------------------------------------------------------------------------
# Routing
# -----------------------------------------------------------------------------

# Get the collector endpoint for a Cascade event.
get_endpoint() {
    local event_name="$1"
    case "$event_name" in
        pre_read_code|post_read_code)     echo "/api/collect/pre-tool-use" ;;
        pre_write_code|post_write_code)   echo "/api/collect/pre-tool-use" ;;
        pre_run_command|post_run_command) echo "/api/collect/pre-tool-use" ;;
        pre_mcp_tool_use|post_mcp_tool_use) echo "/api/collect/pre-tool-use" ;;
        pre_user_prompt)                  echo "/api/collect/user-prompt-submit" ;;
        *)                                 echo "" ;;
    esac
}

# post_* events go to post-tool-use, not pre-tool-use — get_endpoint() above
# groups pre/post together for translate_payload's hook_type switch, so the
# actual endpoint is resolved here from the event name directly.
resolve_endpoint() {
    local event_name="$1"
    case "$event_name" in
        post_read_code|post_write_code|post_run_command|post_mcp_tool_use)
            echo "/api/collect/post-tool-use"
            ;;
        *)
            get_endpoint "$event_name"
            ;;
    esac
}

# Only pre_* events can block, and only they need a synchronous round-trip.
is_pre_event() {
    [[ "$1" == pre_* ]]
}

# -----------------------------------------------------------------------------
# Main Logic
# -----------------------------------------------------------------------------

main() {
    # Read Cascade's JSON payload from stdin
    local cascade_json
    cascade_json=$(cat)

    if [[ -z "$cascade_json" || "$cascade_json" == "{}" ]]; then
        log_debug "Empty input, exiting"
        exit 0
    fi

    if ! command_exists jq; then
        log_error "jq is required for Cascade hook processing"
        exit 0
    fi

    local event_name
    event_name=$(echo "$cascade_json" | jq -r '.agent_action_name // empty' 2>/dev/null)

    if [[ -z "$event_name" ]]; then
        log_error "No agent_action_name in Cascade payload"
        exit 0
    fi

    log_debug "Cascade event: $event_name"

    local endpoint
    endpoint=$(resolve_endpoint "$event_name")

    if [[ -z "$endpoint" ]]; then
        log_debug "No endpoint mapping for event: $event_name (not wired, skipping)"
        exit 0
    fi

    local agentsleak_json
    agentsleak_json=$(translate_payload "$cascade_json" "$event_name")

    if [[ -z "$agentsleak_json" ]]; then
        log_error "Failed to translate payload for event: $event_name"
        exit 0
    fi

    local enriched_json
    enriched_json=$(enrich_payload "$agentsleak_json")

    log_debug "Sending to $endpoint"

    if is_pre_event "$event_name"; then
        # Synchronous: we need a decision before Cascade proceeds.
        local response
        if ! response=$(send_to_collector "$endpoint" "$enriched_json" "$AGENTSLEAK_SYNC_TIMEOUT"); then
            log_debug "Collector unavailable, failing open (allow)"
            exit 0
        fi

        local decision
        decision=$(echo "$response" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)

        if [[ "$decision" == "deny" ]]; then
            local reason
            reason=$(echo "$response" | jq -r '.hookSpecificOutput.permissionDecisionReason // "Blocked by AgentsLeak policy"' 2>/dev/null)
            # Cascade's blocking protocol is exit-code based: stderr + exit 2.
            echo "$reason" >&2
            exit 2
        fi

        exit 0
    else
        # Post-hooks cannot block — fire and forget.
        send_to_collector_async "$endpoint" "$enriched_json"
        log_debug "Async event sent: $event_name"
        exit 0
    fi
}

main "$@"
