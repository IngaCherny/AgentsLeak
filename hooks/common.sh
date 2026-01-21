#!/bin/bash
# =============================================================================
# AgentsLeak - Common Utilities for Sensor Hooks
# =============================================================================
# Shared functions and configuration for all hook scripts.
# This file should be sourced by other hook scripts, not executed directly.
# =============================================================================

# -----------------------------------------------------------------------------
# Configuration (config file > environment variables > defaults)
# -----------------------------------------------------------------------------
AGENTSLEAK_CONFIG="${HOME}/.agentsleak/config.env"
if [ -f "$AGENTSLEAK_CONFIG" ]; then
    # shellcheck source=/dev/null
    source "$AGENTSLEAK_CONFIG"
fi

AGENTSLEAK_PORT="${AGENTSLEAK_PORT:-3827}"
AGENTSLEAK_HOST="${AGENTSLEAK_HOST:-localhost}"
AGENTSLEAK_SERVER="${AGENTSLEAK_SERVER:-http://${AGENTSLEAK_HOST}:${AGENTSLEAK_PORT}}"
AGENTSLEAK_BASE_URL="${AGENTSLEAK_SERVER}"

# API key for authentication (optional — if not set, no auth header sent)
AGENTSLEAK_API_KEY="${AGENTSLEAK_API_KEY:-}"

# Session source identification (claude_code or cursor)
AGENTSLEAK_SESSION_SOURCE="${AGENTSLEAK_SESSION_SOURCE:-claude_code}"

# Endpoint identification (auto-detected if not set)
AGENTSLEAK_HOSTNAME="${AGENTSLEAK_HOSTNAME:-$(hostname -s 2>/dev/null || echo unknown)}"
AGENTSLEAK_USER="${AGENTSLEAK_USER:-$(whoami 2>/dev/null || echo "${USER:-unknown}")}"

# Timeouts (in seconds)
AGENTSLEAK_SYNC_TIMEOUT="${AGENTSLEAK_SYNC_TIMEOUT:-0.2}"
AGENTSLEAK_ASYNC_TIMEOUT="${AGENTSLEAK_ASYNC_TIMEOUT:-5}"

# -----------------------------------------------------------------------------
# Dependency Checks
# -----------------------------------------------------------------------------

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Verify required dependencies are available
check_dependencies() {
    local missing=()

    if ! command_exists curl; then
        missing+=("curl")
    fi

    if ! command_exists jq; then
        missing+=("jq")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        # Log to stderr so it doesn't interfere with stdout
        echo "[AgentsLeak] Warning: Missing dependencies: ${missing[*]}" >&2
        return 1
    fi

    return 0
}

# -----------------------------------------------------------------------------
# Payload Enrichment
# -----------------------------------------------------------------------------

# Enrich a JSON payload with metadata
# Input: JSON string via stdin or first argument
# Output: Enriched JSON string to stdout
enrich_payload() {
    local input_json

    # Read from stdin if no argument provided
    if [[ -n "$1" ]]; then
        input_json="$1"
    else
        input_json=$(cat)
    fi

    # If jq is not available, return the original payload
    if ! command_exists jq; then
        echo "$input_json"
        return 0
    fi

    # Get metadata
    local timestamp
    local hostname_val
    local username_val
    local pid_val

    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")
    hostname_val=$(hostname 2>/dev/null || echo "unknown")
    username_val=$(whoami 2>/dev/null || echo "${USER:-unknown}")
    pid_val="$$"

    # Enrich the JSON payload
    echo "$input_json" | jq --arg ts "$timestamp" \
                            --arg host "$hostname_val" \
                            --arg user "$username_val" \
                            --arg pid "$pid_val" \
                            '. + {
                                _metadata: {
                                    timestamp: $ts,
                                    hostname: $host,
                                    username: $user,
                                    collector_pid: $pid,
                                    agentsleak_version: "1.0.0"
                                }
                            }' 2>/dev/null || echo "$input_json"
}

# -----------------------------------------------------------------------------
# HTTP Communication
# -----------------------------------------------------------------------------

# Send data to the collector (synchronous - waits for response)
# Arguments:
#   $1 - endpoint (e.g., "/api/collect/pre-tool-use")
#   $2 - JSON payload
#   $3 - timeout in seconds (optional, defaults to AGENTSLEAK_SYNC_TIMEOUT)
# Returns:
#   0 on success, 1 on failure
#   Response body is written to stdout
send_to_collector() {
    local endpoint="$1"
    local payload="$2"
    local timeout="${3:-$AGENTSLEAK_SYNC_TIMEOUT}"
    local url="${AGENTSLEAK_BASE_URL}${endpoint}"

    if ! command_exists curl; then
        echo "{}"
        return 1
    fi

    # Send the request and capture both response and status
    local response
    local http_code

    # Use curl with:
    # --silent: No progress meter
    # --show-error: Show errors if they occur
    # --max-time: Total timeout
    # --connect-timeout: Connection timeout (half of max-time)
    # -w: Write out HTTP status code
    # -o: Output response to stdout via /dev/stdout
    # Build auth and endpoint headers
    # NOTE: bash 3.x (macOS default) treats empty arrays as unbound with set -u.
    # Use ${arr[@]+"${arr[@]}"} pattern to safely expand potentially-empty arrays.
    local auth_header=()
    if [[ -n "$AGENTSLEAK_API_KEY" ]]; then
        auth_header+=(-H "X-AgentsLeak-Key: $AGENTSLEAK_API_KEY")
    fi

    response=$(echo "$payload" | curl --silent \
                    --show-error \
                    --max-time "$timeout" \
                    --connect-timeout "$(echo "$timeout / 2" | bc -l 2>/dev/null || echo "0.1")" \
                    -X POST \
                    -H "Content-Type: application/json" \
                    -H "X-Endpoint-Hostname: $AGENTSLEAK_HOSTNAME" \
                    -H "X-Endpoint-User: $AGENTSLEAK_USER" \
                    -H "X-AgentsLeak-Source: $AGENTSLEAK_SESSION_SOURCE" \
                    ${auth_header[@]+"${auth_header[@]}"} \
                    -d @- \
                    -w "\n%{http_code}" \
                    "$url" 2>/dev/null)

    local curl_exit=$?

    if [[ $curl_exit -ne 0 ]]; then
        # curl failed (timeout, connection refused, etc.)
        echo "{}"
        return 1
    fi

    # Extract HTTP code (last line) and response body (everything else)
    http_code=$(echo "$response" | tail -n1)
    local body
    body=$(echo "$response" | sed '$d')

    # Output the response body
    echo "$body"

    # Return success for 2xx status codes
    if [[ "$http_code" =~ ^2[0-9][0-9]$ ]]; then
        return 0
    else
        return 1
    fi
}

# Send data to the collector asynchronously (fire and forget)
# Arguments:
#   $1 - endpoint
#   $2 - JSON payload
# Returns:
#   Always returns 0 immediately
send_to_collector_async() {
    local endpoint="$1"
    local payload="$2"
    local url="${AGENTSLEAK_BASE_URL}${endpoint}"

    if ! command_exists curl; then
        return 0
    fi

    # Fire and forget - run curl in background with nohup
    # Redirect all output to /dev/null
    # Build auth and endpoint headers
    local auth_header=()
    if [[ -n "$AGENTSLEAK_API_KEY" ]]; then
        auth_header+=(-H "X-AgentsLeak-Key: $AGENTSLEAK_API_KEY")
    fi

    (
        echo "$payload" | nohup curl --silent \
                   --max-time "$AGENTSLEAK_ASYNC_TIMEOUT" \
                   -X POST \
                   -H "Content-Type: application/json" \
                   -H "X-Endpoint-Hostname: $AGENTSLEAK_HOSTNAME" \
                   -H "X-Endpoint-User: $AGENTSLEAK_USER" \
                   -H "X-AgentsLeak-Source: $AGENTSLEAK_SESSION_SOURCE" \
                   ${auth_header[@]+"${auth_header[@]}"} \
                   -d @- \
                   "$url" >/dev/null 2>&1 &
    ) &

    return 0
}

# -----------------------------------------------------------------------------
# Input Helpers
# -----------------------------------------------------------------------------

# Read JSON from stdin with timeout
# Arguments:
#   $1 - timeout in seconds (optional, defaults to 1)
# Returns:
#   JSON string to stdout, empty string if timeout or error
read_stdin_json() {
    local timeout="${1:-1}"
    local input

    # Use read with timeout if available
    if read -t "$timeout" -r input 2>/dev/null; then
        # Read any remaining lines
        while IFS= read -t 0.1 -r line 2>/dev/null; do
            input="${input}${line}"
        done
        echo "$input"
    else
        # Fallback: just cat stdin
        cat 2>/dev/null || echo ""
    fi
}

# -----------------------------------------------------------------------------
# Logging (for debugging)
# -----------------------------------------------------------------------------

# Log a message to stderr (won't interfere with JSON output)
log_debug() {
    if [[ "${AGENTSLEAK_DEBUG:-0}" == "1" ]]; then
        echo "[AgentsLeak $(date +%H:%M:%S)] $*" >&2
    fi
}

log_error() {
    echo "[AgentsLeak ERROR] $*" >&2
}

# -----------------------------------------------------------------------------
# Script Directory Detection
# -----------------------------------------------------------------------------

# Get the directory where the hook scripts are installed
get_hooks_dir() {
    local script_path
    script_path="${BASH_SOURCE[0]}"

    # Resolve symlinks
    while [[ -L "$script_path" ]]; do
        local dir
        dir=$(dirname "$script_path")
        script_path=$(readlink "$script_path")
        [[ "$script_path" != /* ]] && script_path="$dir/$script_path"
    done

    dirname "$script_path"
}

# Export the hooks directory
AGENTSLEAK_HOOKS_DIR=$(get_hooks_dir)
export AGENTSLEAK_HOOKS_DIR
