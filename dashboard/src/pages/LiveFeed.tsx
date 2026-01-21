import { useState, useMemo } from 'react';
import { Pause, Play, Trash2, Filter, Download, X, Search, AlertTriangle, Monitor, Layers, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LiveIndicator } from '@/components/common/LiveIndicator';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { EventCard } from '@/components/events/EventCard';
import { AlertCard } from '@/components/alerts/AlertCard';
import { useSessions, useEndpointStats } from '@/api/queries';
import { EventCategory, Severity, SessionStatus } from '@/api/types';

type TabType = 'events' | 'alerts';

export default function LiveFeed() {
  const [activeTab, setActiveTab] = useState<TabType>('events');
  const [showFilters, setShowFilters] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<Severity | ''>('');
  const [sessionFilter, setSessionFilter] = useState<string>('');
  const [endpointFilter, setEndpointFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  const {
    events,
    alerts,
    isConnected,
    clearEvents,
    clearAlerts,
    isPaused,
    pauseUpdates,
    resumeUpdates,
  } = useLiveEvents({ maxEvents: 200 });

  // Fetch active sessions for the session filter dropdown
  const { data: sessionsData } = useSessions({ status: SessionStatus.Active }, 1, 50);
  const activeSessions = useMemo(() => sessionsData?.items || [], [sessionsData]);

  // Endpoint stats for the endpoint filter
  const { data: endpointData } = useEndpointStats();
  const endpoints = useMemo(() => {
    const items = endpointData?.items || [];
    const unique = new Map<string, string>();
    for (const ep of items) {
      const label = ep.endpoint_user
        ? `${ep.endpoint_user}@${ep.endpoint_hostname || '?'}`
        : ep.endpoint_hostname || 'unknown';
      unique.set(ep.endpoint_hostname || 'unknown', label);
    }
    return Array.from(unique.entries()).map(([hostname, label]) => ({ hostname, label }));
  }, [endpointData]);

  // Build session-id → endpoint lookup from active sessions
  const sessionEndpointMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of activeSessions) {
      if (s.endpoint_user || s.endpoint_hostname) {
        map.set(s.session_id, s.endpoint_user
          ? `${s.endpoint_user}@${s.endpoint_hostname || '?'}`
          : s.endpoint_hostname || '');
      }
    }
    return map;
  }, [activeSessions]);

  // Build session-id → source lookup
  const sessionSourceMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of activeSessions) {
      if (s.session_source) {
        map.set(s.session_id, s.session_source);
      }
    }
    return map;
  }, [activeSessions]);

  // Filter events based on filters
  const filteredEvents = useMemo(() => {
    // Build set of session_ids that belong to the selected endpoint
    let endpointSessionIds: Set<string> | null = null;
    if (endpointFilter) {
      endpointSessionIds = new Set<string>();
      for (const s of activeSessions) {
        if (s.endpoint_hostname === endpointFilter) {
          endpointSessionIds.add(s.session_id);
        }
      }
    }

    return events.filter((event) => {
      if (categoryFilter && event.category !== categoryFilter) return false;
      if (severityFilter && event.severity !== severityFilter) return false;
      if (sessionFilter && event.session_id !== sessionFilter) return false;
      if (endpointSessionIds && !endpointSessionIds.has(event.session_id)) return false;
      if (sourceFilter) {
        const eventSource = sessionSourceMap.get(event.session_id) || 'claude_code';
        if (eventSource !== sourceFilter) return false;
      }
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesTool = (event.tool_name || '').toLowerCase().includes(query);
        const matchesFiles = event.file_paths?.some(f => f.toLowerCase().includes(query));
        const matchesCommands = event.commands?.some(c => c.toLowerCase().includes(query));
        const matchesSession = event.session_id.toLowerCase().includes(query);
        if (!matchesTool && !matchesFiles && !matchesCommands && !matchesSession) return false;
      }
      return true;
    });
  }, [events, categoryFilter, severityFilter, sessionFilter, endpointFilter, sourceFilter, searchQuery, activeSessions, sessionSourceMap]);

  // Filter alerts based on filters
  const filteredAlerts = useMemo(() => {
    let endpointSessionIds: Set<string> | null = null;
    if (endpointFilter) {
      endpointSessionIds = new Set<string>();
      for (const s of activeSessions) {
        if (s.endpoint_hostname === endpointFilter) {
          endpointSessionIds.add(s.session_id);
        }
      }
    }

    return alerts.filter((alert) => {
      if (severityFilter && alert.severity !== severityFilter) return false;
      if (sessionFilter && alert.session_id !== sessionFilter) return false;
      if (endpointSessionIds && !endpointSessionIds.has(alert.session_id)) return false;
      if (sourceFilter) {
        const alertSource = sessionSourceMap.get(alert.session_id) || 'claude_code';
        if (alertSource !== sourceFilter) return false;
      }
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = alert.title.toLowerCase().includes(query);
        const matchesDesc = alert.description.toLowerCase().includes(query);
        if (!matchesTitle && !matchesDesc) return false;
      }
      return true;
    });
  }, [alerts, severityFilter, sessionFilter, endpointFilter, sourceFilter, searchQuery, activeSessions, sessionSourceMap]);

  const clearFilters = () => {
    setCategoryFilter('');
    setSeverityFilter('');
    setSessionFilter('');
    setEndpointFilter('');
    setSourceFilter('');
    setSearchQuery('');
  };

  const hasActiveFilters = categoryFilter || severityFilter || sessionFilter || endpointFilter || sourceFilter || searchQuery;

  const handleExport = () => {
    const data = activeTab === 'events' ? filteredEvents : filteredAlerts;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentsleak-${activeTab}-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <LiveIndicator connected={isConnected} />
          <div className="flex items-center gap-2 text-sm opacity-50">
            <span>{filteredEvents.length} events</span>
            <span>|</span>
            <span>{filteredAlerts.length} alerts</span>
          </div>
          {isPaused && (
            <span className="px-2.5 py-0.5 bg-severity-medium/[0.12] text-severity-medium text-xs font-bold uppercase rounded-full">
              Paused
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => (isPaused ? resumeUpdates() : pauseUpdates())}
            className={cn(
              'btn flex items-center gap-2',
              isPaused ? 'btn-primary' : 'btn-secondary'
            )}
          >
            {isPaused ? (
              <>
                <Play className="w-4 h-4" />
                Resume
              </>
            ) : (
              <>
                <Pause className="w-4 h-4" />
                Pause
              </>
            )}
          </button>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'btn btn-secondary flex items-center gap-2',
              showFilters && 'bg-carbon/[0.14]'
            )}
          >
            <Filter className="w-4 h-4" />
            Filters
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-carbon" />
            )}
          </button>

          <button
            onClick={() => {
              if (activeTab === 'events') clearEvents();
              else clearAlerts();
            }}
            className="btn btn-secondary flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>

          <button
            onClick={handleExport}
            className="btn btn-secondary flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="flex items-center gap-3 flex-wrap animate-fade-in">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
            <input
              type="text"
              placeholder="Search events..."
              className="input-search pl-9 pr-8 w-52 text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100 hover:text-alert-red"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Category */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="input-search pl-9 pr-8 w-44 text-sm appearance-none cursor-pointer"
            >
              <option value="">All Categories</option>
              <option value={EventCategory.FileRead}>File Read</option>
              <option value={EventCategory.FileWrite}>File Write</option>
              <option value={EventCategory.FileDelete}>File Delete</option>
              <option value={EventCategory.CommandExec}>Command Exec</option>
              <option value={EventCategory.NetworkAccess}>Network Access</option>
              <option value={EventCategory.CodeExecution}>Code Execution</option>
              <option value={EventCategory.SubagentSpawn}>Subagent Spawn</option>
              <option value={EventCategory.McpToolUse}>MCP Tool</option>
            </select>
            {categoryFilter && (
              <button
                onClick={() => setCategoryFilter('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100 hover:text-alert-red"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Severity */}
          <div className="relative">
            <AlertTriangle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as Severity | '')}
              className="input-search pl-9 pr-8 w-40 text-sm appearance-none cursor-pointer"
            >
              <option value="">All Severities</option>
              <option value={Severity.Critical}>Critical</option>
              <option value={Severity.High}>High</option>
              <option value={Severity.Medium}>Medium</option>
              <option value={Severity.Low}>Low</option>
              <option value={Severity.Info}>Info</option>
            </select>
            {severityFilter && (
              <button
                onClick={() => setSeverityFilter('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100 hover:text-alert-red"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Endpoint */}
          <div className="relative">
            <Monitor className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
            <select
              value={endpointFilter}
              onChange={(e) => setEndpointFilter(e.target.value)}
              className="input-search pl-9 pr-8 w-48 text-sm appearance-none cursor-pointer"
            >
              <option value="">All Endpoints</option>
              {endpoints.map((ep) => (
                <option key={ep.hostname} value={ep.hostname}>
                  {ep.label}
                </option>
              ))}
            </select>
            {endpointFilter && (
              <button
                onClick={() => setEndpointFilter('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100 hover:text-alert-red"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Source */}
          <div className="relative">
            <Cpu className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="input-search pl-9 pr-8 w-40 text-sm appearance-none cursor-pointer"
            >
              <option value="">All Sources</option>
              <option value="claude_code">Claude Code</option>
              <option value="cursor">Cursor</option>
            </select>
            {sourceFilter && (
              <button
                onClick={() => setSourceFilter('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100 hover:text-alert-red"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Session */}
          <div className="relative">
            <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
            <select
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
              className="input-search pl-9 pr-8 w-44 text-sm appearance-none cursor-pointer"
            >
              <option value="">All Sessions</option>
              {activeSessions.map((session) => {
                const epLabel = session.endpoint_user
                  ? `${session.endpoint_user}@`
                  : '';
                return (
                  <option key={session.id} value={session.session_id}>
                    {epLabel}{session.cwd?.split('/').pop() || session.session_id.slice(0, 8)}
                  </option>
                );
              })}
            </select>
            {sessionFilter && (
              <button
                onClick={() => setSessionFilter('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100 hover:text-alert-red"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Clear All */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs opacity-40 hover:opacity-100 hover:text-alert-red flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-carbon/[0.06]">
        <nav className="flex gap-6">
          <button
            onClick={() => setActiveTab('events')}
            className={cn(
              'pb-3 text-sm font-medium transition-colors border-b-2',
              activeTab === 'events'
                ? 'text-carbon border-carbon'
                : 'opacity-50 border-transparent hover:opacity-100 hover:text-alert-red'
            )}
          >
            Events ({filteredEvents.length})
          </button>
          <button
            onClick={() => setActiveTab('alerts')}
            className={cn(
              'pb-3 text-sm font-medium transition-colors border-b-2',
              activeTab === 'alerts'
                ? 'text-carbon border-carbon'
                : 'opacity-50 border-transparent hover:opacity-100 hover:text-alert-red'
            )}
          >
            Alerts ({filteredAlerts.length})
          </button>
        </nav>
      </div>

      {/* Live Feed Content */}
      <div className="card">
        {activeTab === 'events' ? (
          <>
            {/* Events Table Header */}
            <div className="grid grid-cols-12 gap-3 px-4 py-2.5 border-b border-carbon/10 text-[10px] font-mono uppercase tracking-wider font-bold opacity-50 bg-carbon/[0.03]">
              <div className="col-span-1">Time</div>
              <div className="col-span-2">Endpoint</div>
              <div className="col-span-1">Session</div>
              <div className="col-span-2">Category</div>
              <div className="col-span-1">Severity</div>
              <div className="col-span-4">Details</div>
              <div className="col-span-1"></div>
            </div>

            {/* Events List */}
            <div className="divide-y divide-carbon/[0.06]">
              {filteredEvents.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-[10px] bg-carbon/[0.06] mb-4">
                    <Play className="w-8 h-8 opacity-40" />
                  </div>
                  <h3 className="text-lg font-medium opacity-60 mb-2">
                    {hasActiveFilters ? 'No matching events' : 'Waiting for events...'}
                  </h3>
                  <p className="opacity-50 max-w-md mx-auto">
                    {hasActiveFilters
                      ? 'Try adjusting your filters to see more events.'
                      : 'Events will appear here in real-time as AI agents perform actions. Make sure you have agents connected and running.'}
                  </p>
                </div>
              ) : (
                filteredEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    showSession
                    endpointLabel={sessionEndpointMap.get(event.session_id)}
                  />
                ))
              )}
            </div>
          </>
        ) : (
          <>
            {/* Alerts Table Header */}
            <div className="grid grid-cols-12 gap-3 px-4 py-2.5 border-b border-carbon/10 text-[10px] font-mono uppercase tracking-wider font-bold opacity-50 bg-carbon/[0.03]">
              <div className="col-span-1">Severity</div>
              <div className="col-span-3">Alert</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-2">Time</div>
              <div className="col-span-2">Endpoint</div>
              <div className="col-span-1">Session</div>
              <div className="col-span-2"></div>
            </div>

            {/* Alerts List */}
            <div className="divide-y divide-carbon/[0.06]">
              {filteredAlerts.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-[10px] bg-carbon/[0.06] mb-4">
                    <Play className="w-8 h-8 opacity-40" />
                  </div>
                  <h3 className="text-lg font-medium opacity-60 mb-2">
                    {hasActiveFilters ? 'No matching alerts' : 'No alerts yet'}
                  </h3>
                  <p className="opacity-50 max-w-md mx-auto">
                    {hasActiveFilters
                      ? 'Try adjusting your filters to see more alerts.'
                      : 'Alerts will appear here when security policies are triggered.'}
                  </p>
                </div>
              ) : (
                filteredAlerts.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    tableRow
                    endpointLabel={sessionEndpointMap.get(alert.session_id)}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
