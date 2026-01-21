// Enums - match backend values
export enum EventCategory {
  FileRead = 'file_read',
  FileWrite = 'file_write',
  FileDelete = 'file_delete',
  CommandExec = 'command_exec',
  NetworkAccess = 'network_access',
  CodeExecution = 'code_execution',
  SubagentSpawn = 'subagent_spawn',
  McpToolUse = 'mcp_tool_use',
  SessionLifecycle = 'session_lifecycle',
  Unknown = 'unknown',
}

export enum Severity {
  Critical = 'critical',
  High = 'high',
  Medium = 'medium',
  Low = 'low',
  Info = 'info',
}

export enum AlertStatus {
  New = 'new',
  Investigating = 'investigating',
  Confirmed = 'confirmed',
  FalsePositive = 'false_positive',
  Resolved = 'resolved',
  Escalated = 'escalated',
}

export enum SessionStatus {
  Active = 'active',
  Ended = 'ended',
}

// Core Types - match backend response shapes (snake_case)
export interface Session {
  id: string;
  session_id: string;
  started_at: string;
  ended_at?: string | null;
  cwd?: string | null;
  parent_session_id?: string | null;
  event_count: number;
  alert_count: number;
  risk_score?: number;
  status: string;
  endpoint_hostname?: string | null;
  endpoint_user?: string | null;
  session_source?: string | null;
  // Detail fields
  events_by_category?: Record<string, number>;
  events_by_severity?: Record<string, number>;
  alerts_by_severity?: Record<string, number>;
  first_event_at?: string | null;
  last_event_at?: string | null;
}

export interface Event {
  id: string;
  session_id: string;
  timestamp: string;
  hook_type: string;
  tool_name: string | null;
  category: string;
  severity: string;
  file_paths: string[];
  commands: string[];
  urls: string[];
  ip_addresses?: string[];
  tool_input?: Record<string, unknown> | null;
  tool_result?: Record<string, unknown> | null;
  processed?: boolean;
  enriched?: boolean;
  raw_payload?: Record<string, unknown> | null;
}

export interface Alert {
  id: string;
  session_id: string;
  created_at: string;
  updated_at: string;
  title: string;
  description: string;
  severity: string;
  category: string;
  status: string;
  assigned_to?: string | null;
  policy_id?: string | null;
  policy_name?: string | null;
  event_ids: string[];
  evidence: AlertEvidence[];
  action_taken?: string | null;
  blocked: boolean;
  tags: string[];
  metadata: Record<string, unknown>;
  endpoint_hostname?: string | null;
  endpoint_user?: string | null;
}

export interface AlertEvidence {
  event_id: string;
  timestamp: string;
  description: string;
  data: Record<string, unknown>;
  file_path?: string | null;
  command?: string | null;
  url?: string | null;
}

export interface AlertContextEvent {
  id: string;
  timestamp: string;
  tool_name: string;
  category: string;
  severity: string;
  description: string;
  is_trigger: boolean;
}

export interface AlertContext {
  alert_id: string;
  session_id: string;
  events: AlertContextEvent[];
}

export interface AlertGraphNode {
  id: string;
  node_type: string;
  label: string;
  value: string;
  alert_count: number;
  is_trigger: boolean;
  blocked?: boolean;
}

export interface AlertGraphEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
}

export interface AlertGraph {
  alert_id: string;
  session_id: string;
  alert_title?: string;
  alert_description?: string;
  alert_severity?: string;
  blocked?: boolean;
  policy_name?: string | null;
  nodes: AlertGraphNode[];
  edges: AlertGraphEdge[];
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  categories: string[];
  tools: string[];
  conditions: PolicyCondition[];
  condition_logic: string;
  action: string;
  severity: string;
  alert_title: string;
  alert_description: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  hit_count?: number;
}

export interface PolicyCondition {
  field: string;
  operator: string;
  value: unknown;
  case_sensitive?: boolean;
}

export interface PolicyAction {
  type: 'alert' | 'block' | 'log' | 'notify';
  config?: Record<string, unknown>;
}

// Graph Types - match backend GraphResponse
export interface GraphNode {
  id: string;
  node_type: string;
  label: string;
  value: string;
  first_seen: string;
  last_seen: string;
  access_count: number;
  alert_count: number;
  size: number;
  color: string | null;
}

export interface GraphEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  first_seen: string;
  last_seen: string;
  count: number;
  weight: number;
  color: string | null;
}

export interface GraphStats {
  total_nodes: number;
  total_edges: number;
  nodes_by_type: Record<string, number>;
  edges_by_relation: Record<string, number>;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
  time_range?: { min: string; max: string } | null;
}

// Dashboard Types - match backend /api/stats/dashboard response
export interface DashboardStats {
  total_sessions: number;
  active_sessions: number;
  total_events: number;
  total_alerts: number;
  new_alerts: number;
  blocked_actions: number;
  endpoint_count: number;
  alerts_by_severity: Record<string, number>;
  events_by_category: Record<string, number>;
  recent_alerts: RecentAlert[];
  recent_events: RecentEvent[];
  sessions_by_source?: Record<string, number>;
}

export interface EndpointStatsEntry {
  endpoint_hostname: string | null;
  endpoint_user: string | null;
  session_count: number;
  total_events: number;
  total_alerts: number;
}

export interface RecentAlert {
  id: string;
  title: string;
  severity: string;
  status: string;
  session_id: string;
  created_at: string;
}

export interface RecentEvent {
  id: string;
  tool_name: string | null;
  category: string;
  severity: string;
  session_id: string;
  timestamp: string;
}

export interface TimelinePoint {
  timestamp: string;
  events: number;
  alerts: number;
}

export interface TimelineResponse {
  points: TimelinePoint[];
  total_events: number;
  total_alerts: number;
  start_time: string;
  end_time: string;
}

// API Response Types - match backend paginated responses
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Filter Types
export interface SessionFilters {
  status?: string;
  hostname?: string;
  endpoint?: string;
  username?: string;
  session_source?: string;
  from_date?: string;
  to_date?: string;
}

export interface EventFilters {
  session_id?: string;
  category?: string;
  severity?: string;
  tool_name?: string;
  blocked?: boolean;
  from_date?: string;
  to_date?: string;
}

export interface AlertFilters {
  session_id?: string;
  status?: string;
  severity?: string;
  rule_id?: string;
  endpoint?: string;
  from_date?: string;
  to_date?: string;
}

// WebSocket Types
export interface WebSocketMessage {
  type: 'event' | 'alert' | 'session_update' | 'stats_update';
  payload: unknown;
}

export interface LiveEvent extends Event {
  isNew?: boolean;
}

export interface LiveAlert extends Alert {
  isNew?: boolean;
}
