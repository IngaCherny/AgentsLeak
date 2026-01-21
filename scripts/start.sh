#!/bin/bash
# AgentsLeak - Setup and Run Script
# This script sets up and runs both the backend and dashboard

set -e

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

# Check Node version
echo -e "${YELLOW}Checking Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js is required but not installed.${NC}"
    exit 1
fi
node --version

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
pip install -e ".[dev]" --quiet

# Install dashboard dependencies
echo -e "${YELLOW}Installing dashboard dependencies...${NC}"
cd dashboard
if [ ! -d "node_modules" ]; then
    npm install --silent
fi
cd ..

echo
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo

# Create data directory
mkdir -p ~/.agentsleak

# Install hooks into Claude Code (idempotent — safe to re-run)
echo -e "${YELLOW}Installing hooks into Claude Code...${NC}"
if command -v jq &> /dev/null; then
    bash "$PROJECT_DIR/hooks/install.sh" --unattended
    echo -e "${GREEN}✓ Hooks installed${NC}"
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

# Start dashboard
echo -e "${BLUE}Starting dashboard on http://localhost:${DASHBOARD_PORT}...${NC}"
cd dashboard
npm run dev -- --port "$DASHBOARD_PORT" &
DASHBOARD_PID=$!
cd ..
sleep 3

echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  AgentsLeak is running!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo -e "  ${BLUE}Dashboard:${NC}  http://localhost:${DASHBOARD_PORT}"
echo -e "  ${BLUE}API:${NC}        http://${AGENTSLEAK_HOST}:${AGENTSLEAK_PORT}"
echo -e "  ${BLUE}API Docs:${NC}   http://${AGENTSLEAK_HOST}:${AGENTSLEAK_PORT}/docs"
echo
echo -e "  ${GREEN}Hooks are installed. Restart any open Claude Code sessions to start monitoring.${NC}"
echo
echo -e "  ${YELLOW}Press Ctrl+C to stop${NC}"
echo

# Wait for processes
wait
