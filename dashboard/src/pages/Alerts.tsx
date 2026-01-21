import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Search,
  RefreshCw,
  Loader2,
  X,
  Shield,
  ShieldOff,
  CheckCircle,
  Monitor,
  Cpu,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAlerts, useUpdateAlertStatus, useEndpointStats, useSessions } from '@/api/queries';
import { AlertCard } from '@/components/alerts/AlertCard';
import { Severity, AlertStatus } from '@/api/types';
import type { Alert } from '@/api/types';

type StatusFilter = string | 'all';
type ActionFilter = 'all' | 'blocked' | 'alert';

// Severity group config
const SEVERITY_GROUPS = [
  {
    key: 'critical',
    label: 'Critical',
    bg: 'bg-severity-critical/[0.04]',
    dot: 'bg-severity-critical',
    badge: 'bg-severity-critical text-white',
    match: (a: Alert) => a.severity === Severity.Critical,
  },
  {
    key: 'high',
    label: 'High',
    bg: 'bg-severity-high/[0.04]',
    dot: 'bg-severity-high',
    badge: 'bg-severity-high text-white',
    match: (a: Alert) => a.severity === Severity.High,
  },
  {
    key: 'medium',
    label: 'Medium',
    bg: 'bg-severity-medium/[0.04]',
    dot: 'bg-severity-medium',
    badge: 'bg-severity-medium text-white',
    match: (a: Alert) => a.severity === Severity.Medium,
  },
  {
    key: 'low',
    label: 'Low & Info',
    bg: 'bg-carbon/[0.02]',
    dot: 'bg-carbon/30',
    badge: 'bg-carbon/10 text-carbon',
    match: (a: Alert) => a.severity === Severity.Low || a.severity === Severity.Info,
  },
];

// ─── Stats Cards ────────────────────────────────────────────────────────────

function AlertStatsCards({ alerts }: { alerts: Alert[] }) {
  const total = alerts.length;
  const criticalCount = alerts.filter(a => a.severity === Severity.Critical).length;
  const blockedCount = alerts.filter(a => a.blocked).length;
  const resolvedCount = alerts.filter(a => a.status === AlertStatus.Resolved || a.status === AlertStatus.FalsePositive).length;

  return (
    <div className="grid grid-cols-4 gap-3">
      <div className="card p-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-[10px] bg-carbon/[0.08] flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-carbon/60" />
        </div>
        <div>
          <p className="text-xl font-bold text-carbon">{total}</p>
          <p className="text-[10px] font-mono opacity-40 uppercase">Total Alerts</p>
        </div>
      </div>
      <div className="card p-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-[10px] bg-severity-critical/[0.12] flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-severity-critical" />
        </div>
        <div>
          <p className="text-xl font-bold text-severity-critical">{criticalCount}</p>
          <p className="text-[10px] font-mono opacity-40 uppercase">Critical</p>
        </div>
      </div>
      <div className="card p-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-[10px] bg-[#D90429]/[0.12] flex items-center justify-center">
          <ShieldOff className="w-5 h-5 text-[#D90429]" />
        </div>
        <div>
          <p className="text-xl font-bold text-[#D90429]">{blockedCount}</p>
          <p className="text-[10px] font-mono opacity-40 uppercase">Blocked</p>
        </div>
      </div>
      <div className="card p-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-[10px] bg-green-500/[0.12] flex items-center justify-center">
          <CheckCircle className="w-5 h-5 text-green-500" />
        </div>
        <div>
          <p className="text-xl font-bold text-green-600">{resolvedCount}</p>
          <p className="text-[10px] font-mono opacity-40 uppercase">Resolved</p>
        </div>
      </div>
    </div>
  );
}

export default function Alerts() {
  const [searchParams, setSearchParams] = useSearchParams();
  const ruleIdParam = searchParams.get('rule_id') || undefined;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
  const [endpointFilter, setEndpointFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [resolvedCollapsed, setResolvedCollapsed] = useState(true);
  const pageSize = 50;

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

  const clearRuleFilter = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('rule_id');
    setSearchParams(newParams);
    setPage(1);
  };

  const filters = {
    status: statusFilter === 'all' ? undefined : statusFilter,
    rule_id: ruleIdParam,
    ...(endpointFilter !== 'all' ? { endpoint: endpointFilter } : {}),
  };

  // Fetch sessions for source filtering
  const { data: sessionsData } = useSessions(undefined, 1, 200);
  const sessionSourceMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of (sessionsData?.items || [])) {
      if (s.session_source) {
        map.set(s.session_id, s.session_source);
      }
    }
    return map;
  }, [sessionsData]);

  const { data, isLoading, isError, error, refetch, isFetching } = useAlerts(filters, page, pageSize);
  const updateStatusMutation = useUpdateAlertStatus();

  const alerts = data?.items || [];
  const total = data?.total || 0;
  const hasMore = data ? page < data.pages : false;

  // Client-side filtering (search + action type + source)
  const filteredAlerts = alerts.filter((alert) => {
    if (actionFilter === 'blocked' && !alert.blocked) return false;
    if (actionFilter === 'alert' && alert.blocked) return false;
    if (sourceFilter !== 'all') {
      const alertSource = sessionSourceMap.get(alert.session_id) || 'claude_code';
      if (alertSource !== sourceFilter) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        alert.title.toLowerCase().includes(q) ||
        (alert.description || '').toLowerCase().includes(q) ||
        (alert.policy_name || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Split into active vs resolved
  const activeAlerts = filteredAlerts.filter(
    a => a.status === AlertStatus.New || a.status === AlertStatus.Investigating
  );
  const resolvedAlerts = filteredAlerts.filter(
    a => a.status === AlertStatus.Resolved || a.status === AlertStatus.FalsePositive
  );

  // Group active alerts by severity
  const groups = SEVERITY_GROUPS.map(g => ({
    ...g,
    alerts: activeAlerts.filter(g.match),
  })).filter(g => g.alerts.length > 0);

  const handleAcknowledge = (id: string) => {
    updateStatusMutation.mutate({ id, status: AlertStatus.Investigating });
  };

  const handleResolve = (id: string) => {
    updateStatusMutation.mutate({ id, status: AlertStatus.Resolved });
  };

  const handleMarkFalsePositive = (id: string) => {
    updateStatusMutation.mutate({ id, status: AlertStatus.FalsePositive });
  };

  const toggleGroup = (key: string) => {
    const next = new Set(collapsedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsedGroups(next);
  };

  const hasActiveFilters = searchQuery || actionFilter !== 'all';
  const blockedCount = filteredAlerts.filter(a => a.blocked).length;

  const startIndex = (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, total);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
            <input
              type="text"
              placeholder="Search alerts..."
              className="input-search pl-9 w-56 text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-60"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Status pills */}
          <div className="flex items-center gap-1 bg-carbon/[0.04] rounded-full p-0.5">
            {([
              { value: 'all' as StatusFilter, label: 'All' },
              { value: AlertStatus.New, label: 'New' },
              { value: AlertStatus.Investigating, label: 'Investigating' },
              { value: AlertStatus.Resolved, label: 'Resolved' },
            ]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => { setStatusFilter(opt.value); setPage(1); }}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-full transition-all',
                  statusFilter === opt.value
                    ? 'bg-carbon text-white shadow-sm'
                    : 'text-carbon/50 hover:text-alert-red'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Action filter */}
          <div className="flex items-center gap-1 bg-carbon/[0.04] rounded-full p-0.5">
            {([
              { value: 'all' as ActionFilter, label: 'All' },
              { value: 'blocked' as ActionFilter, label: 'Blocked' },
              { value: 'alert' as ActionFilter, label: 'Alert' },
            ]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => { setActionFilter(opt.value); setPage(1); }}
                className={cn(
                  'px-2.5 py-1 text-[10px] font-mono uppercase rounded-full transition-all',
                  actionFilter === opt.value
                    ? opt.value === 'blocked'
                      ? 'bg-[#D90429] text-white shadow-sm'
                      : opt.value === 'alert'
                        ? 'bg-carbon/70 text-white shadow-sm'
                        : 'bg-carbon text-white shadow-sm'
                    : 'text-carbon/40 hover:text-alert-red'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Endpoint Filter */}
          {endpoints.length > 0 && (
            <div className="relative">
              <Monitor className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
              <select
                value={endpointFilter}
                onChange={(e) => {
                  setEndpointFilter(e.target.value);
                  setPage(1);
                }}
                className="input-search pl-9 pr-8 w-52 text-sm appearance-none cursor-pointer"
              >
                <option value="all">All Endpoints</option>
                {endpoints.map((ep) => (
                  <option key={ep.hostname} value={ep.hostname}>
                    {ep.label}
                  </option>
                ))}
              </select>
              {endpointFilter !== 'all' && (
                <button
                  onClick={() => { setEndpointFilter('all'); setPage(1); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100 hover:text-alert-red"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {/* Source Filter */}
          <div className="relative">
            <Cpu className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
            <select
              value={sourceFilter}
              onChange={(e) => {
                setSourceFilter(e.target.value);
                setPage(1);
              }}
              className="input-search pl-9 pr-8 w-44 text-sm appearance-none cursor-pointer"
            >
              <option value="all">All Sources</option>
              <option value="claude_code">Claude Code</option>
              <option value="cursor">Cursor</option>
            </select>
            {sourceFilter !== 'all' && (
              <button
                onClick={() => { setSourceFilter('all'); setPage(1); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100 hover:text-alert-red"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {ruleIdParam && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-carbon/[0.05] rounded-full text-xs font-mono">
              <Shield className="w-3 h-3 opacity-50" />
              <span className="opacity-60">Policy filter</span>
              <button onClick={clearRuleFilter} className="ml-1 opacity-40 hover:text-alert-red">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {hasActiveFilters && (
            <button
              onClick={() => { setSearchQuery(''); setActionFilter('all'); }}
              className="text-xs opacity-40 hover:opacity-100 hover:text-alert-red flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono opacity-40">
            {filteredAlerts.length} alerts &middot; {blockedCount} blocked
          </span>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn btn-secondary flex items-center gap-2 text-sm"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {!isLoading && !isError && <AlertStatsCards alerts={filteredAlerts} />}

      {/* Error State */}
      {isError && (
        <div className="card p-6">
          <div className="flex items-center gap-3 text-carbon">
            <AlertTriangle className="w-5 h-5" />
            <p>Failed to load alerts: {(error as Error)?.message || 'Unknown error'}</p>
          </div>
          <button onClick={() => refetch()} className="mt-4 btn btn-secondary text-sm">
            Try Again
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="p-4 bg-carbon/[0.02]">
                <div className="h-4 bg-carbon/10 w-24" />
              </div>
              {[...Array(3)].map((__, j) => (
                <div key={j} className="px-4 py-3 border-t flex items-center gap-4">
                  <div className="w-4 h-4 rounded-full bg-carbon/10" />
                  <div className="flex-1">
                    <div className="h-4 rounded bg-carbon/10 w-64 mb-1" />
                    <div className="h-3 rounded bg-carbon/10 w-40" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Grouped Sections */}
      {!isLoading && !isError && (
        <>
          {filteredAlerts.length === 0 ? (
            <div className="card p-12 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-[10px] bg-carbon/[0.06] mb-4">
                <AlertTriangle className="w-8 h-8 opacity-40" />
              </div>
              <h3 className="text-lg font-medium opacity-60 mb-2">
                {hasActiveFilters || statusFilter !== 'all' || endpointFilter !== 'all' || sourceFilter !== 'all'
                  ? 'No matching alerts'
                  : 'No alerts'}
              </h3>
              <p className="opacity-50">
                {hasActiveFilters || statusFilter !== 'all' || endpointFilter !== 'all' || sourceFilter !== 'all'
                  ? 'Try adjusting your filters or selecting a different endpoint.'
                  : 'All clear! No alerts to display.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Active alerts grouped by severity */}
              {groups.map(group => {
                const isCollapsed = collapsedGroups.has(group.key);
                return (
                  <div key={group.key} className="card">
                    {/* Group header */}
                    <div
                      className={cn('px-4 py-3 flex items-center justify-between cursor-pointer transition-colors', group.bg)}
                      onClick={() => toggleGroup(group.key)}
                    >
                      <div className="flex items-center gap-3">
                        {isCollapsed
                          ? <ChevronRight className="w-4 h-4" />
                          : <ChevronDown className="w-4 h-4" />
                        }
                        <div className={cn('w-2.5 h-2.5 rounded-full', group.dot)} />
                        <span className="font-bold text-sm">{group.label}</span>
                      </div>
                      <span className={cn('px-2 py-0.5 text-xs font-bold rounded-full', group.badge)}>
                        {group.alerts.length}
                      </span>
                    </div>

                    {/* Alerts */}
                    {!isCollapsed && (
                      <div>
                        {group.alerts.map(alert => (
                          <AlertCard
                            key={alert.id}
                            alert={alert}
                            onAcknowledge={handleAcknowledge}
                            onResolve={handleResolve}
                            onMarkFalsePositive={handleMarkFalsePositive}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Resolved & Dismissed section */}
              {resolvedAlerts.length > 0 && (
                <div className="card">
                  <div
                    className="px-4 py-3 flex items-center justify-between cursor-pointer transition-colors bg-green-500/[0.04]"
                    onClick={() => setResolvedCollapsed(!resolvedCollapsed)}
                  >
                    <div className="flex items-center gap-3">
                      {resolvedCollapsed
                        ? <ChevronRight className="w-4 h-4" />
                        : <ChevronDown className="w-4 h-4" />
                      }
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                      <span className="font-bold text-sm">Resolved & Dismissed</span>
                    </div>
                    <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-green-500/10 text-green-700">
                      {resolvedAlerts.length}
                    </span>
                  </div>

                  {!resolvedCollapsed && (
                    <div>
                      {resolvedAlerts.map(alert => (
                        <AlertCard
                          key={alert.id}
                          alert={alert}
                          onAcknowledge={handleAcknowledge}
                          onResolve={handleResolve}
                          onMarkFalsePositive={handleMarkFalsePositive}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Pagination */}
      {!isLoading && !isError && total > pageSize && (
        <div className="flex items-center justify-between">
          <p className="text-xs font-mono opacity-40">
            {startIndex}-{endIndex} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button
              className="rounded-full bg-carbon/[0.06] hover:bg-carbon/[0.12] px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-30 disabled:pointer-events-none"
              disabled={page === 1 || isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className="px-3 py-2 text-xs font-mono opacity-40">Page {page}</span>
            <button
              className="rounded-full bg-carbon/[0.06] hover:bg-carbon/[0.12] px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-30 disabled:pointer-events-none"
              disabled={!hasMore || isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Mutation loading */}
      {updateStatusMutation.isPending && (
        <div className="fixed bottom-4 right-4 bg-white rounded-xl shadow-[0_2px_6px_rgba(0,0,0,0.06),0_10px_36px_rgba(0,0,0,0.1)] px-4 py-2 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-carbon" />
          <span className="text-sm text-carbon">Updating alert...</span>
        </div>
      )}
    </div>
  );
}
