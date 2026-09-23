#!/bin/bash
# AgentsLeak - Setup and Run Script
# This script sets up and runs both the backend and dashboard

set -e

# Usage: ./scripts/start.sh [--dev] [--global | --project [DIR]]... [--reconfigure]
#   --dev            run the Vite dev server (hot reload, needs Node.js) instead
#                    of the prebuilt dashboard served by the backend
#   --global         monitor every Claude Code session on this machine
#   --project [DIR]  monitor only sessions started in DIR (default: the folder
#                    you ran this from); repeat for several projects
#   --reconfigure    ask again which sessions to monitor
# Without scope flags the saved choice is reused (see scripts/set-scope.sh);
# on first run the default is the folder you ran from, never global.
DEV_MODE=false
SCOPE_ARG=""
SCOPE_PROJECTS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --dev) DEV_MODE=true ;;
        --global) SCOPE_ARG=global ;;
        --reconfigure) SCOPE_ARG=choose ;;
        --project=*) SCOPE_ARG=project; SCOPE_PROJECTS+=("${1#--project=}") ;;
        --project)
            SCOPE_ARG=project
            if [ -n "${2:-}" ] && [ "${2#-}" = "$2" ]; then
                SCOPE_PROJECTS+=("$2")
                shift
            fi
            ;;
        -h|--help)
            sed -n '7,15p' "$0" | sed 's/^# //'
            exit 0
            ;;
        *) echo "Unknown option: $1 (see --help)" >&2; exit 1 ;;
    esac
    shift
done

# Relative --project paths are resolved from where the user ran the script.
export AGENTSLEAK_CALLER_DIR="$PWD"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}                    AgentsLeak — Runtime Security for AI Agents${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Check Python version
echo -e "${YELLOW}Checking Python...${NC}"
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Python 3 is required but not installed.${NC}"
    exit 1
fi
python3 --version

# Node.js is only needed for dashboard development (or if the prebuilt
# dashboard is missing from this checkout).
PREBUILT_DASHBOARD="$PROJECT_DIR/agentsleak/static/dashboard/index.html"
if [ "$DEV_MODE" = false ] && [ ! -f "$PREBUILT_DASHBOARD" ]; then
    echo -e "${YELLOW}Prebuilt dashboard not found — falling back to dev mode (requires Node.js).${NC}"
    DEV_MODE=true
fi

if [ "$DEV_MODE" = true ]; then
    echo -e "${YELLOW}Checking Node.js...${NC}"
    if ! command -v node &> /dev/null; then
        echo -e "${RED}Node.js is required for --dev mode but not installed.${NC}"
        exit 1
    fi
    node --version
fi

echo

# Set up Python virtual environment
echo -e "${YELLOW}Setting up Python virtual environment...${NC}"
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
    echo -e "${GREEN}✓ Virtual environment created${NC}"
fi
source .venv/bin/activate

# Install Python dependencies
echo -e "${YELLOW}Installing Python dependencies...${NC}"
pip install -e . --quiet

# Install dashboard dependencies (dev mode only)
if [ "$DEV_MODE" = true ]; then
    echo -e "${YELLOW}Installing dashboard dependencies...${NC}"
    cd dashboard
    if [ ! -d "node_modules" ]; then
        npm install --silent
    fi
    cd ..
fi

echo
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo

# Create data directory
mkdir -p ~/.agentsleak

# Install hooks into Claude Code (idempotent — safe to re-run)
echo -e "${YELLOW}Installing hooks into Claude Code...${NC}"
if command -v jq &> /dev/null; then
    SET_SCOPE="$PROJECT_DIR/scripts/set-scope.sh"
    if [ "$SCOPE_ARG" = project ]; then
        bash "$SET_SCOPE" project ${SCOPE_PROJECTS[@]+"${SCOPE_PROJECTS[@]}"}
    elif [ -n "$SCOPE_ARG" ]; then
        bash "$SET_SCOPE" "$SCOPE_ARG"
    elif [ -f "$HOME/.agentsleak/scope.conf" ]; then
        bash "$SET_SCOPE" apply
    elif [ -t 0 ]; then
        bash "$SET_SCOPE" choose
    else
        # Non-interactive first run: never touch the global config by default.
        bash "$SET_SCOPE" project "$AGENTSLEAK_CALLER_DIR"
    fi
    bash "$SET_SCOPE" status
else
    echo -e "${RED}jq is required for hook installation. Install it with: brew install jq${NC}"
    echo -e "${YELLOW}Skipping hook installation — you can run ./hooks/install.sh manually after installing jq${NC}"
fi
echo

# Function to cleanup background processes
cleanup() {
    echo
    echo -e "${YELLOW}Shutting down...${NC}"
    kill $BACKEND_PID 2>/dev/null || true
    kill $DASHBOARD_PID 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

# Configurable host/port (override via environment)
AGENTSLEAK_HOST="${AGENTSLEAK_HOST:-127.0.0.1}"
AGENTSLEAK_PORT="${AGENTSLEAK_PORT:-3827}"
DASHBOARD_PORT="${DASHBOARD_PORT:-5173}"

# Start backend
echo -e "${BLUE}Starting backend on http://${AGENTSLEAK_HOST}:${AGENTSLEAK_PORT}...${NC}"
python3 -m agentsleak --host "$AGENTSLEAK_HOST" --port "$AGENTSLEAK_PORT" &
BACKEND_PID=$!
sleep 2

# Check if backend started
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "${RED}Failed to start backend${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Backend running (PID: $BACKEND_PID)${NC}"

# Start dashboard: Vite dev server in dev mode, otherwise the backend serves
# the prebuilt dashboard itself.
if [ "$DEV_MODE" = true ]; then
    echo -e "${BLUE}Starting dashboard dev server on http://localhost:${DASHBOARD_PORT}...${NC}"
    cd dashboard
    npm run dev -- --port "$DASHBOARD_PORT" &
    DASHBOARD_PID=$!
    cd ..
    sleep 3
    DASHBOARD_URL="http://localhost:${DASHBOARD_PORT}"
else
    DASHBOARD_URL="http://${AGENTSLEAK_HOST}:${AGENTSLEAK_PORT}"
fi

echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  AgentsLeak is running!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo -e "  ${BLUE}Dashboard:${NC}  ${DASHBOARD_URL}"
echo -e "  ${BLUE}API:${NC}        http://${AGENTSLEAK_HOST}:${AGENTSLEAK_PORT}"
echo -e "  ${BLUE}API Docs:${NC}   http://${AGENTSLEAK_HOST}:${AGENTSLEAK_PORT}/docs"
echo
echo -e "  ${GREEN}Restart Claude Code sessions in the monitored scope to pick up the hooks.${NC}"
echo -e "  Change scope anytime: ./scripts/set-scope.sh (status | global | project DIR...)"
echo
echo -e "  ${YELLOW}Press Ctrl+C to stop${NC}"
echo

# Wait for processes
wait
