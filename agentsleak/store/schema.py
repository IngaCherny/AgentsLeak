"""SQLite schema for AgentsLeak database."""

SCHEMA_SQL = """
-- ============================================================================
-- AgentsLeak Database Schema
-- ============================================================================

-- Sessions table: Tracks Claude Code sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    cwd TEXT,
    parent_session_id TEXT,
    event_count INTEGER DEFAULT 0,
    alert_count INTEGER DEFAULT 0,
    risk_score INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    endpoint_hostname TEXT,
    endpoint_user TEXT,
    session_source TEXT,
    metadata TEXT,  -- JSON blob for additional data
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);

-- Events table: Stores all captured events
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    hook_type TEXT NOT NULL,
    tool_name TEXT,
    tool_input TEXT,  -- JSON blob
    tool_result TEXT,  -- JSON blob
    category TEXT DEFAULT 'unknown',
    severity TEXT DEFAULT 'info',
    file_paths TEXT,  -- JSON array
    commands TEXT,  -- JSON array
    urls TEXT,  -- JSON array
    ip_addresses TEXT,  -- JSON array
    processed INTEGER DEFAULT 0,
    enriched INTEGER DEFAULT 0,
    raw_payload TEXT,  -- JSON blob
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_hook_type ON events(hook_type);
CREATE INDEX IF NOT EXISTS idx_events_tool_name ON events(tool_name);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity);
CREATE INDEX IF NOT EXISTS idx_events_processed ON events(processed);

-- Alerts table: Stores security alerts
CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT DEFAULT 'medium',
    category TEXT DEFAULT 'unknown',
    status TEXT DEFAULT 'new',
    assigned_to TEXT,
    policy_id TEXT,
    event_ids TEXT,  -- JSON array of event IDs
    evidence TEXT,  -- JSON array of evidence objects
    action_taken TEXT,
    blocked INTEGER DEFAULT 0,
    tags TEXT,  -- JSON array
    metadata TEXT,  -- JSON blob
    FOREIGN KEY (session_id) REFERENCES sessions(session_id),
    FOREIGN KEY (policy_id) REFERENCES policies(id)
);

CREATE INDEX IF NOT EXISTS idx_alerts_session_id ON alerts(session_id);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_policy_id ON alerts(policy_id);

-- Policies table: Detection policies and rules
CREATE TABLE IF NOT EXISTS policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    enabled INTEGER DEFAULT 1,
    categories TEXT,  -- JSON array of event categories
    tools TEXT,  -- JSON array of tool names
    conditions TEXT,  -- JSON array of condition objects
    condition_logic TEXT DEFAULT 'all',
    action TEXT DEFAULT 'alert',
    severity TEXT DEFAULT 'medium',
    alert_title TEXT,
    alert_description TEXT,
    tags TEXT,  -- JSON array
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_policies_name ON policies(name);
CREATE INDEX IF NOT EXISTS idx_policies_enabled ON policies(enabled);

-- Graph nodes table: Activity graph vertices
CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY,
    node_type TEXT NOT NULL,
    label TEXT NOT NULL,
    value TEXT NOT NULL,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    access_count INTEGER DEFAULT 1,
    alert_count INTEGER DEFAULT 0,
    session_ids TEXT,  -- JSON array
    event_ids TEXT,  -- JSON array
    size REAL DEFAULT 1.0,
    color TEXT,
    metadata TEXT,  -- JSON blob
    UNIQUE(node_type, value)
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_value ON graph_nodes(value);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_type_value ON graph_nodes(node_type, value);

-- Graph edges table: Activity graph relationships
CREATE TABLE IF NOT EXISTS graph_edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    count INTEGER DEFAULT 1,
    session_ids TEXT,  -- JSON array
    event_ids TEXT,  -- JSON array
    weight REAL DEFAULT 1.0,
    color TEXT,
    metadata TEXT,  -- JSON blob
    FOREIGN KEY (source_id) REFERENCES graph_nodes(id),
    FOREIGN KEY (target_id) REFERENCES graph_nodes(id),
    UNIQUE(source_id, target_id, relation)
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_relation ON graph_edges(relation);

-- ============================================================================
-- Summary and Statistics Tables
-- ============================================================================

-- Hourly statistics for dashboard
CREATE TABLE IF NOT EXISTS stats_hourly (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hour_start TIMESTAMP NOT NULL,
    total_events INTEGER DEFAULT 0,
    total_alerts INTEGER DEFAULT 0,
    events_by_category TEXT,  -- JSON object
    events_by_severity TEXT,  -- JSON object
    alerts_by_severity TEXT,  -- JSON object
    active_sessions INTEGER DEFAULT 0,
    unique_files INTEGER DEFAULT 0,
    unique_commands INTEGER DEFAULT 0,
    unique_urls INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(hour_start)
);

CREATE INDEX IF NOT EXISTS idx_stats_hourly_hour ON stats_hourly(hour_start);

-- File access summary
CREATE TABLE IF NOT EXISTS file_access_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    read_count INTEGER DEFAULT 0,
    write_count INTEGER DEFAULT 0,
    delete_count INTEGER DEFAULT 0,
    last_accessed TIMESTAMP,
    session_ids TEXT,  -- JSON array
    alert_count INTEGER DEFAULT 0,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(file_path)
);

CREATE INDEX IF NOT EXISTS idx_file_access_path ON file_access_summary(file_path);
CREATE INDEX IF NOT EXISTS idx_file_access_last ON file_access_summary(last_accessed);

-- Command execution summary
CREATE TABLE IF NOT EXISTS command_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command TEXT NOT NULL,
    command_hash TEXT NOT NULL,  -- Hash of command for grouping similar commands
    execution_count INTEGER DEFAULT 0,
    last_executed TIMESTAMP,
    session_ids TEXT,  -- JSON array
    exit_codes TEXT,  -- JSON array of observed exit codes
    alert_count INTEGER DEFAULT 0,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(command_hash)
);

CREATE INDEX IF NOT EXISTS idx_command_summary_hash ON command_summary(command_hash);
CREATE INDEX IF NOT EXISTS idx_command_summary_last ON command_summary(last_executed);

-- Network access summary
CREATE TABLE IF NOT EXISTS network_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT,
    hostname TEXT,
    ip_address TEXT,
    port INTEGER,
    access_count INTEGER DEFAULT 0,
    last_accessed TIMESTAMP,
    session_ids TEXT,  -- JSON array
    alert_count INTEGER DEFAULT 0,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(hostname, ip_address, port)
);

CREATE INDEX IF NOT EXISTS idx_network_summary_hostname ON network_summary(hostname);
CREATE INDEX IF NOT EXISTS idx_network_summary_ip ON network_summary(ip_address);

-- ============================================================================
-- Triggers for automatic timestamp updates
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS update_sessions_timestamp
AFTER UPDATE ON sessions
BEGIN
    UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_alerts_timestamp
AFTER UPDATE ON alerts
BEGIN
    UPDATE alerts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_policies_timestamp
AFTER UPDATE ON policies
BEGIN
    UPDATE policies SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ============================================================================
-- Schema version tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);
"""
