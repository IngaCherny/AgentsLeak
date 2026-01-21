# Architecture

This document describes the technical architecture of AgentsLeak, a runtime security monitoring platform for AI coding agents.

## Table of Contents

- [System Overview](#system-overview)
- [Data Flow](#data-flow)
- [Backend](#backend)
  - [Collector](#collector)
  - [Detection Engine](#detection-engine)
  - [Policy System](#policy-system)
  - [Database](#database)
  - [Graph Engine](#graph-engine)
  - [WebSocket](#websocket)
- [Frontend](#frontend)
  - [Pages](#pages)
  - [Graph Visualization](#graph-visualization)
  - [Real-time Updates](#real-time-updates)
- [Hook Integration](#hook-integration)
- [Data Models](#data-models)
- [Security Considerations](#security-considerations)

---

## System Overview

AgentsLeak operates as a sidecar service alongside AI coding agents. It receives telemetry through hooks, processes events through a detection engine, and presents findings through a web dashboard.

```
                        ┌──────────────────────┐
                        │    Claude Code        │
                        │                       │
                        │  PreToolUse ──────────┼──── Can BLOCK before execution
                        │  PostToolUse ─────────┼──── Logs after execution
                        │  SessionStart/End ────┼──── Session lifecycle
                        │  SubagentStart ───────┼──── Subagent tracking
                        └──────────┬────────────┘
                                   │ HTTP POST (JSON)
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         AgentsLeak Server (:3827)                        │
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐    │
│  │              │    │              │    │                          │    │
│  │  Collector   │───▶│   Engine     │───▶│   Database (SQLite)      │    │
│  │              │    │              │    │                          │    │
│  │  Receives    │    │  Classifies  │    │  events, sessions,       │    │
│  │  hook events │    │  Evaluates   │    │  alerts, policies,       │    │
│  │  Returns     │    │  policies    │    │  graph_nodes/edges,      │    │
│  │  decisions   │    │  Generates   │    │  stats, summaries        │    │
│  │              │    │  alerts      │    │                          │    │
│  └──────────────┘    └──────┬───────┘    └──────────────────────────┘    │
│                             │                                            │
│                             ▼                                            │
│                      ┌──────────────┐    ┌──────────────────────────┐    │
│                      │  WebSocket   │    │   REST API               │    │
│                      │  (push)      │    │   /api/sessions          │    │
│                      └──────────────┘    │   /api/events            │    │
│                             │            │   /api/alerts            │    │
│                             │            │   /api/policies          │    │
│                             │            │   /api/graph             │    │
│                             │            │   /api/stats             │    │
│                             │            └──────────────────────────┘    │
└─────────────────────────────┼───────────────────────┬───────────────────┘
                              │                       │
                              ▼                       ▼
                    ┌──────────────────────────────────────┐
                    │       Dashboard (React SPA)           │
                    │                                       │
                    │  Dashboard · Sessions · Alerts        │
                    │  Graph · Policies · Live Feed         │
                    └──────────────────────────────────────┘
```

## Data Flow

### PreToolUse (blocking path)

This is the critical path — it executes synchronously before a tool runs and can block the action.

```
1. Claude Code calls a tool (e.g., Bash with "rm -rf /")
2. PreToolUse hook fires → HTTP POST to /api/collect/pre-tool-use
3. Collector creates Event from payload
4. Engine.evaluate_pre_tool() runs synchronously:
   a. Classify event (category, severity)
   b. Extract metadata (file paths, commands, URLs, IPs)
   c. Match against enabled policies
   d. If a BLOCK policy matches → create Alert, return deny Decision
   e. If ALERT policy matches → create Alert, return allow Decision
   f. No match → return allow Decision
5. Event is saved to database
6. Event is queued for async post-processing (graph updates, stats)
7. Decision is returned to Claude Code in hook response format:
   - Allow: {} or {hookSpecificOutput: {permissionDecision: "allow"}}
   - Block: {hookSpecificOutput: {permissionDecision: "deny", permissionDecisionReason: "..."}}
```

### PostToolUse (logging path)

This path is non-blocking — it records what happened after a tool executed.

```
1. Claude Code finishes executing a tool
2. PostToolUse hook fires → HTTP POST to /api/collect/post-tool-use
3. Collector creates Event, saves to database
4. Event queued for async processing:
   a. Classification and enrichment
   b. Policy evaluation (ALERT actions only — blocking not possible post-execution)
   c. Graph node/edge updates
   d. Statistics aggregation
5. Returns {status: "received"}
```

---

## Backend

The backend is a Python/FastAPI application. All modules live under `agentsleak/`.

### Collector

**Module**: `agentsleak/collector/routes.py`

The collector provides HTTP endpoints that receive hook payloads from Claude Code. Each endpoint maps to a specific hook event type:

| Endpoint | Hook | Behavior |
|---|---|---|
| `POST /api/collect/pre-tool-use` | PreToolUse | Synchronous evaluation, may return block decision |
| `POST /api/collect/post-tool-use` | PostToolUse | Async processing, always returns `{status: received}` |
| `POST /api/collect/session-start` | SessionStart | Creates session record |
| `POST /api/collect/session-end` | SessionEnd | Marks session as ended |
| `POST /api/collect/subagent-start` | SubagentStart | Creates child session with parent reference |
| `POST /api/collect/post-tool-use-error` | PostToolUseFailure | Logs failed tool executions |

Sessions are auto-created on first event if no explicit `session-start` was received.

### Detection Engine

**Module**: `agentsleak/engine/processor.py`

The Engine class manages the event processing pipeline:

```python
class Engine:
    async def start()              # Start async processing loop
    async def stop()               # Stop processing loop
    async def evaluate_pre_tool()  # Synchronous pre-execution policy check
    async def enqueue()            # Queue event for async processing
    async def _process_loop()      # Background loop: classify, evaluate, update graph
```

**Processing pipeline** (per event):

1. **Classification** (`classifier.py`) — Maps tool names to event categories:
   - `Read`, `Glob`, `Grep` → `FILE_READ`
   - `Write`, `Edit` → `FILE_WRITE`
   - `Bash` → `COMMAND_EXEC`
   - `WebFetch`, `WebSearch` → `NETWORK_ACCESS`
   - `Task` → `SUBAGENT_SPAWN`

2. **Enrichment** — Extracts structured metadata from raw tool inputs:
   - File paths from `file_path`, `path`, and command arguments
   - Commands from `command` field
   - URLs from `url` field and command strings
   - IP addresses from commands and URLs

3. **Severity computation** — Based on category, file sensitivity, and command risk:
   - `CRITICAL`: reverse shells, SSH key access, credential theft
   - `HIGH`: writing to sensitive directories, suspicious network requests
   - `MEDIUM`: file writes, command execution
   - `LOW`: file reads, search operations
   - `INFO`: session lifecycle events

4. **Policy evaluation** — Match event against all enabled policies
5. **Alert generation** — Create alerts for matched policies
6. **Graph update** — Add/update graph nodes and edges
7. **Stats update** — Increment hourly counters

### Policy System

**Module**: `agentsleak/config/policy_seeder.py`

Policies are detection rules stored in the database. Each policy defines:

| Field | Description |
|---|---|
| `name` | Unique identifier (e.g., "CRED-001") |
| `categories` | Event categories to match (e.g., `["file_read"]`) |
| `tools` | Specific tools to match (e.g., `["Bash", "Read"]`) |
| `conditions` | Pattern-matching conditions on event fields |
| `condition_logic` | `"all"` (AND) or `"any"` (OR) |
| `action` | `BLOCK`, `ALERT`, or `LOG` |
| `severity` | Alert severity when triggered |

Condition types:
- **`contains`** — Field value contains substring
- **`matches`** — Field value matches regex pattern
- **`equals`** — Exact field match
- **`starts_with`** / **`ends_with`** — Prefix/suffix matching

Default policies are seeded on first startup and cover:
- Credential access (SSH keys, cloud tokens, git credentials)
- Reverse shells and backdoors (bash TCP redirects, netcat, socat)
- Sensitive file access (`/etc/passwd`, `/etc/shadow`, `.env`)
- Data exfiltration (curl/wget POST with file data)
- Reconnaissance (grepping for secrets and passwords)

### Database

**Module**: `agentsleak/store/database.py`, `agentsleak/store/schema.py`

SQLite database with the following tables:

| Table | Purpose |
|---|---|
| `sessions` | Claude Code sessions (active/ended, event counts) |
| `events` | All captured events with classification metadata |
| `alerts` | Security alerts linked to sessions, events, and policies |
| `policies` | Detection rules (conditions, actions, severity) |
| `graph_nodes` | Activity graph vertices (files, processes, domains, tools) |
| `graph_edges` | Activity graph relationships (reads, writes, fetches, executes) |
| `stats_hourly` | Hourly aggregated statistics |
| `file_access_summary` | Per-file access counters |
| `command_summary` | Per-command execution counters |
| `network_summary` | Per-host/IP network access counters |
| `schema_version` | Database migration tracking |

Key indexes are defined on all frequently queried columns (session_id, timestamp, category, severity, status).

Triggers automatically update `updated_at` timestamps on sessions, alerts, and policies.

### Graph Engine

**Module**: `agentsleak/api/graph.py`, `agentsleak/models/graph.py`

The graph engine builds interactive dependency graphs from event data.

**Node types**:
- `session` — A Claude Code session
- `file` — A file that was read or written
- `process` — A command that was executed
- `tool` — A Claude Code tool (Bash, Read, Write, etc.)
- `domain` — A network domain accessed
- `directory` — A directory cluster (when `cluster_dirs=true`)
- `command_group` — Grouped similar commands

**Edge relations**:
- `reads` — Session/tool reads a file
- `writes` — Session/tool writes a file
- `executes` — Session executes a command
- `fetches` — Session/tool fetches a URL
- `spawns` — Session spawns a subagent
- `contains` — Directory contains files

**Directory clustering** (`cluster_dirs=true`):
When a directory contains 3+ file nodes, they are collapsed into a single directory cluster node. This dramatically reduces visual clutter for sessions with many file operations.

**Time-window filtering** (`from_date`, `to_date`):
Events can be filtered by timestamp before building the graph. The API returns `time_range: {min, max}` metadata so the frontend can render a time slider.

### WebSocket

**Module**: `agentsleak/api/websocket.py`

A WebSocket endpoint at `/api/ws` pushes real-time updates to connected dashboard clients. Events include:
- New events as they're processed
- New alerts as they're generated
- Session status changes

---

## Frontend

The dashboard is a React 18 SPA built with TypeScript, Vite, and Tailwind CSS.

### Pages

| Page | Route | Description |
|---|---|---|
| Dashboard | `/` | Overview with statistics, recent alerts, and event timeline chart |
| Sessions | `/sessions` | List of all agent sessions with status, event/alert counts |
| Session Detail | `/sessions/:id` | Deep-dive into a single session's events and alerts |
| Alerts | `/alerts` | All security alerts, filterable by severity, session, and policy |
| Graph | `/graph` | Interactive dependency graph (session or global view) |
| Policies | `/policies` | Detection policy management with hit counts |
| Live Feed | `/live` | Real-time streaming event feed via WebSocket |
| Analytics | `/analytics` | Charts and statistics over time |

### Graph Visualization

Built with [ReactFlow](https://reactflow.dev/) and [Dagre](https://github.com/dagrejs/dagre) for automatic layout.

**Custom node types** (in `components/graph/custom-nodes/`):

| Node | Visual | Description |
|---|---|---|
| `SessionNode` | Green/red circle | Active or ended session with event count |
| `FileNode` | Rectangle | File with read/write indicators and sensitivity coloring |
| `ProcessNode` | Rounded rectangle | Command with running/blocked/error states |
| `ToolNode` | Color-coded card | Tool with risk level (critical/high/medium/low) |
| `DomainNode` | Rounded rectangle | Network domain with suspicious/external indicators |
| `DirectoryNode` | Dashed rectangle | Collapsed directory cluster with file count |
| `CommandGroupNode` | Rounded rectangle | Group of similar commands |

**Features**:
- **Dagre auto-layout**: Left-to-right (LR) hierarchical layout
- **Collapsible nodes**: Click parent nodes to expand/collapse children
- **Time-window slider**: Dual-handle slider to filter graph by time range, with presets (5m, 15m, 1h, All)
- **Directory clustering**: Server-side grouping of files by directory
- **Dark mode**: Full dark theme support with automatic edge color adaptation
- **Minimap**: Bottom-right overview of the full graph

### Real-time Updates

The dashboard uses two mechanisms for real-time data:

1. **WebSocket** (`hooks/useWebSocket.ts`, `hooks/useLiveEvents.ts`): Connects to `/api/ws` for push-based event and alert notifications. Used by the Live Feed page.

2. **TanStack Query** (`api/queries.ts`): Polling-based data fetching with configurable refetch intervals. Used by Dashboard, Sessions, Alerts, and other pages.

### Theming

The dashboard supports light and dark modes via Tailwind CSS's `darkMode: 'class'` strategy.

- Dark mode toggle adds/removes the `dark` class on `<html>`
- CSS overrides in `index.css` handle the dark palette:
  - Background: `#0a0a0a`
  - Card surfaces: `#161616`
  - Borders: `#2a2a2a`
  - Text: `#ececec`
  - Accent: `#D90429`
- A `useDarkMode()` hook (MutationObserver-based) lets components react to theme changes

---

## Hook Integration

AgentsLeak integrates with Claude Code through its [hooks system](https://docs.anthropic.com/en/docs/claude-code/hooks).

### Hook types used

| Hook | When it fires | AgentsLeak behavior |
|---|---|---|
| `PreToolUse` | Before any tool executes | Evaluate policies, may BLOCK the action |
| `PostToolUse` | After a tool executes | Log the event, run detection rules |
| `PostToolUseFailure` | After a tool fails | Log the failure event |
| `SessionStart` | When a session begins | Create session record |
| `SessionEnd` | When a session ends | Mark session as ended |
| `SubagentStart` | When a subagent spawns | Create child session linked to parent |

### Installation

The installer (`hooks/install.sh`) does the following:
1. Copies hook scripts to `~/.agentsleak/hooks/`
2. Reads Claude Code's `settings.json` (at `~/.claude/settings.json`)
3. Merges AgentsLeak hook configuration into the settings
4. Creates a backup of the original settings

Each hook script is a bash wrapper that:
- Reads the JSON payload from stdin
- Forwards it to the AgentsLeak API via `curl`
- Returns the API response to Claude Code (for PreToolUse: allows or blocks)

### Hook response format

For `PreToolUse`, the response controls execution:

```json
// Allow execution (empty response)
{}

// Block execution
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Blocked: reverse shell detected"
  }
}

// Allow with modified input
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "updatedInput": { "command": "echo 'sanitized'" }
  }
}
```

---

## Data Models

### Event

```
Event
├── id: UUID
├── session_id: string
├── timestamp: datetime
├── hook_type: PreToolUse | PostToolUse | SessionStart | SessionEnd | SubagentStart
├── tool_name: string (Bash, Read, Write, Edit, WebFetch, etc.)
├── tool_input: JSON (command, file_path, url, etc.)
├── tool_result: JSON (output, error, exit_code)
├── category: file_read | file_write | command_exec | network_access | subagent_spawn | ...
├── severity: critical | high | medium | low | info
├── file_paths: string[]
├── commands: string[]
├── urls: string[]
└── ip_addresses: string[]
```

### Alert

```
Alert
├── id: UUID
├── session_id: string
├── title: string
├── description: string
├── severity: critical | high | medium | low | info
├── category: EventCategory
├── status: new | investigating | confirmed | false_positive | resolved | escalated
├── policy_id: UUID (reference to triggering policy)
├── event_ids: UUID[] (events that triggered this alert)
├── evidence: AlertEvidence[]
├── blocked: boolean (whether the action was prevented)
└── tags: string[]
```

### Policy

```
Policy
├── id: UUID
├── name: string (unique, e.g. "CRED-001")
├── description: string
├── enabled: boolean
├── categories: EventCategory[] (which event types to match)
├── tools: string[] (which tools to match)
├── conditions: Condition[] (pattern matching rules)
├── condition_logic: "all" | "any"
├── action: block | alert | log
├── severity: Severity
├── alert_title: string (template for generated alert title)
└── alert_description: string (template for generated alert description)
```

---

## Security Considerations

### Threat model

AgentsLeak is designed to monitor agents running in the user's local environment. The threat model assumes:

- The AI agent may attempt to access sensitive files, execute dangerous commands, or exfiltrate data
- The user's system is otherwise trusted
- The AgentsLeak server runs locally and is not exposed to the internet

### Design decisions

1. **Synchronous blocking**: `PreToolUse` evaluation is synchronous to ensure dangerous actions are blocked before execution, even if it adds latency.

2. **Local-only by default**: The server binds to `127.0.0.1` by default. Data stays on the user's machine.

3. **SQLite**: No external database dependency. The database file is stored at `~/.agentsleak/data.db` with standard filesystem permissions.

4. **No authentication**: Since the server runs locally, authentication is not implemented. If exposing to a network, add authentication at the reverse proxy layer.

5. **Fail-open**: If the AgentsLeak server is unreachable, hook scripts fail silently and Claude Code continues operating normally. This prevents AgentsLeak from becoming a single point of failure.

---

## Further Reading

- [README.md](../README.md) — Quick start and API reference
- [docs/TESTING.md](TESTING.md) — Testing documentation
- [Claude Code Hooks Documentation](https://docs.anthropic.com/en/docs/claude-code/hooks) — Official hook system docs
