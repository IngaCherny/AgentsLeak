import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Layers,
  ShieldX,
  Monitor,
  X,
  FileText,
  FileEdit,
  Trash2,
  Terminal,
  Globe,
  Code,
  GitBranch,
  Wrench,
  HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDarkMode } from '@/lib/useDarkMode';
import { useStats, useSessions, useEvents, useEndpointStats } from '@/api/queries';
import { SessionStatus } from '@/api/types';
import type { Event, Session } from '@/api/types';
import { ExpandableText } from '@/components/common/ExpandableText';
import { SourceBadge } from '@/components/sessions/SessionCard';

// ── Event grouping ────────────────────────────────────────────────────

const categoryIcons: Record<string, React.ElementType> = {
  file_read: FileText,
  file_write: FileEdit,
  file_delete: Trash2,
  command_exec: Terminal,
  network_access: Globe,
  code_execution: Code,
  subagent_spawn: GitBranch,
  mcp_tool_use: Wrench,
  session_lifecycle: Layers,
  unknown: HelpCircle,
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
};

const GROUP_WINDOW_MS = 60_000; // 60 seconds

// Categories where grouping makes sense: same action, different targets
const GROUPABLE_CATEGORIES = new Set([
  'file_read', 'file_write', 'file_delete', 'network_access',
]);

interface EventGroup {
  key: string;
  category: string;
  toolName: string;
  severity: string;
  sessionId: string;
  endpointLabel: string;
  count: number;
  newestTimestamp: string;
  filePaths: string[];
  commands: string[];
  urls: string[];
}

function groupEvents(events: Event[], sessionEndpointMap: Map<string, string>): EventGroup[] {
  // Filter out PreToolUse — PostToolUse carries the same info plus result
  const filtered = events.filter(e => e.hook_type !== 'PreToolUse');

  const groups: EventGroup[] = [];

  for (const event of filtered) {
    const last = groups[groups.length - 1];
    const toolName = event.tool_name || event.hook_type || '';

    // Only group categories where it makes sense (same action on different targets).
    // Commands, code exec, subagent spawns etc. are each unique — never group them.
    const canMerge =
      GROUPABLE_CATEGORIES.has(event.category) &&
      last &&
      last.toolName === toolName &&
      last.category === event.category &&
      last.sessionId === event.session_id &&
      Math.abs(
        new Date(last.newestTimestamp).getTime() -
        new Date(event.timestamp).getTime()
      ) <= GROUP_WINDOW_MS;

    if (canMerge) {
      last.count++;
      for (const fp of event.file_paths) {
        if (!last.filePaths.includes(fp)) last.filePaths.push(fp);
      }
      for (const url of event.urls) {
        if (!last.urls.includes(url)) last.urls.push(url);
      }
      if ((SEVERITY_RANK[event.severity] ?? 0) > (SEVERITY_RANK[last.severity] ?? 0)) {
        last.severity = event.severity;
      }
    } else {
      groups.push({
        key: event.id,
        category: event.category,
        toolName,
        severity: event.severity,
        sessionId: event.session_id,
        endpointLabel: sessionEndpointMap.get(event.session_id) || '',
        count: 1,
        newestTimestamp: event.timestamp,
        filePaths: [...event.file_paths],
        commands: [...event.commands],
        urls: [...event.urls],
      });
    }
  }

  return groups;
}

/** Build session_id → "user@host" lookup from sessions data. */
function buildEndpointMap(sessions: Session[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of sessions) {
    if (s.endpoint_user || s.endpoint_hostname) {
      map.set(
        s.session_id,
        s.endpoint_user
          ? `${s.endpoint_user}@${s.endpoint_hostname || '?'}`
          : s.endpoint_hostname || '',
      );
    }
  }
  return map;
}

function baseName(fp: string): string {
  const parts = fp.split('/');
  return parts[parts.length - 1] || fp;
}

// ── Category colors (monochrome + red for command_exec) ──────────────

const CATEGORY_COLORS: Record<string, { light: string; dark: string; bar: string; barDark: string }> = {
  command_exec:     { light: '#D90429', dark: '#D90429',  bar: 'bg-[#D90429]',  barDark: 'bg-[#D90429]' },
  file_read:        { light: '#1A1A1A', dark: '#ececec',  bar: 'bg-[#1A1A1A]',  barDark: 'bg-[#ececec]' },
  file_write:       { light: '#555555', dark: '#aaaaaa',  bar: 'bg-[#555555]',  barDark: 'bg-[#aaaaaa]' },
  network_access:   { light: '#888888', dark: '#777777',  bar: 'bg-[#888888]',  barDark: 'bg-[#777777]' },
  code_execution:   { light: '#b0b0b0', dark: '#555555',  bar: 'bg-[#b0b0b0]',  barDark: 'bg-[#555555]' },
  file_delete:      { light: '#d0d0d0', dark: '#3a3a3a',  bar: 'bg-[#d0d0d0]',  barDark: 'bg-[#3a3a3a]' },
  subagent_spawn:   { light: '#e8e8e8', dark: '#2a2a2a',  bar: 'bg-[#e8e8e8]',  barDark: 'bg-[#2a2a2a]' },
  mcp_tool_use:     { light: '#e0e0e0', dark: '#333333',  bar: 'bg-[#e0e0e0]',  barDark: 'bg-[#333333]' },
  session_lifecycle: { light: '#eeeeee', dark: '#222222', bar: 'bg-[#eeeeee]',  barDark: 'bg-[#222222]' },
};

/** Build SVG donut segments from sorted category data. */
function buildDonutSegments(
  entries: [string, number][],
  total: number,
  isDark: boolean,
): { category: string; color: string; dashArray: string; dashOffset: number }[] {
  const circumference = 2 * Math.PI * 38; // r=38
  let offset = 0;
  return entries.map(([category, count]) => {
    const pct = total > 0 ? count / total : 0;
    const arcLen = pct * circumference;
    const gap = circumference - arcLen;
    const colors = CATEGORY_COLORS[category] || { light: '#d0d0d0', dark: '#3a3a3a' };
    const color = isDark ? colors.dark : colors.light;
    const segment = {
      category,
      color,
      dashArray: `${arcLen} ${gap}`,
      dashOffset: -offset,
    };
    offset += arcLen;
    return segment;
  });
}

// ── Components ───────────────────────────────────────────────────────

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  isLoading?: boolean;
}

const statCardStyles: Record<string, { iconBg: string; iconColor: string; valueColor: string }> = {
  'Active Sessions': { iconBg: 'bg-green-500/[0.12]', iconColor: 'text-green-500', valueColor: 'text-green-600' },
  'Total Events': { iconBg: 'bg-carbon/[0.08]', iconColor: 'text-carbon/60', valueColor: 'text-carbon' },
  'Alerts': { iconBg: 'bg-amber-500/[0.12]', iconColor: 'text-amber-500', valueColor: 'text-severity-medium' },
  'Blocked Actions': { iconBg: 'bg-[#D90429]/[0.12]', iconColor: 'text-[#D90429]', valueColor: 'text-severity-critical' },
  'Endpoints': { iconBg: 'bg-carbon/[0.08]', iconColor: 'text-carbon/60', valueColor: 'text-carbon' },
};

function StatCard({ title, value, icon: Icon, isLoading }: StatCardProps) {
  const style = statCardStyles[title] || statCardStyles['Total Events'];
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={cn('w-10 h-10 rounded-[10px] flex items-center justify-center flex-shrink-0', style.iconBg)}>
        <Icon className={cn('w-5 h-5', style.iconColor)} />
      </div>
      <div>
        {isLoading ? (
          <div className="h-7 w-16 bg-carbon/10 rounded animate-pulse" />
        ) : (
          <p className={cn('text-xl font-bold', style.valueColor)}>{value}</p>
        )}
        <p className="text-[10px] font-mono opacity-40 uppercase">{title}</p>
      </div>
    </div>
  );
}

function formatCategory(category: string): string {
  return category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

function severityBadge(severity: string): string {
  switch (severity) {
    case 'critical': return 'badge badge-critical';
    case 'high': return 'badge badge-high';
    case 'medium': return 'badge badge-medium';
    case 'low': return 'badge badge-low';
    default: return 'badge badge-info';
  }
}

export default function Dashboard() {
  const isDark = useDarkMode();
  const [endpointFilter, setEndpointFilter] = useState<string>('all');

  const activeEndpoint = endpointFilter !== 'all' ? endpointFilter : undefined;
  const { data: stats, isLoading: statsLoading } = useStats(undefined, undefined, activeEndpoint);
  const { data: eventsData, isLoading: eventsLoading } = useEvents(undefined, 1, 50);

  // Endpoint data for the scope selector
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

  // Active sessions — filter by endpoint when scoped
  const sessionFilters = {
    status: SessionStatus.Active,
    ...(endpointFilter !== 'all' ? { endpoint: endpointFilter } : {}),
  };
  const { data: sessionsData, isLoading: sessionsLoading } = useSessions(sessionFilters, 1, 10);

  // All recent sessions for session→endpoint lookup (broader than active-only)
  const { data: allSessionsData } = useSessions(undefined, 1, 100);
  const sessionEndpointMap = useMemo(
    () => buildEndpointMap(allSessionsData?.items || []),
    [allSessionsData],
  );

  const activeSessions = sessionsData?.items || [];
  const allEvents = useMemo(() => eventsData?.items || [], [eventsData]);

  // Client-side endpoint filtering for events
  const filteredEvents = useMemo(() => {
    if (endpointFilter === 'all') return allEvents;
    const epSessionIds = new Set<string>();
    for (const s of (allSessionsData?.items || [])) {
      if (s.endpoint_hostname === endpointFilter) epSessionIds.add(s.session_id);
    }
    return allEvents.filter(e => epSessionIds.has(e.session_id));
  }, [allEvents, endpointFilter, allSessionsData]);

  const groupedEvents = groupEvents(filteredEvents, sessionEndpointMap);

  // Filter recent alerts by endpoint
  const filteredRecentAlerts = useMemo(() => {
    if (!stats?.recent_alerts) return [];
    if (endpointFilter === 'all') return stats.recent_alerts;
    const epSessionIds = new Set<string>();
    for (const s of (allSessionsData?.items || [])) {
      if (s.endpoint_hostname === endpointFilter) epSessionIds.add(s.session_id);
    }
    return stats.recent_alerts.filter(a => epSessionIds.has(a.session_id));
  }, [stats?.recent_alerts, endpointFilter, allSessionsData]);

  const isFiltered = endpointFilter !== 'all';
  const filterLabel = endpoints.find(e => e.hostname === endpointFilter)?.label || endpointFilter;

  return (
    <div className="space-y-8">
      {/* Global Endpoint Scope Selector */}
      {endpoints.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="relative">
            <Monitor className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
            <select
              value={endpointFilter}
              onChange={(e) => setEndpointFilter(e.target.value)}
              className="input-search pl-9 pr-8 w-56 text-sm appearance-none cursor-pointer"
            >
              <option value="all">All Endpoints</option>
              {endpoints.map((ep) => (
                <option key={ep.hostname} value={ep.hostname}>
                  {ep.label}
                </option>
              ))}
            </select>
            {isFiltered && (
              <button
                onClick={() => setEndpointFilter('all')}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100 hover:text-alert-red"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
        <StatCard
          title="Active Sessions"
          value={stats?.active_sessions ?? 0}
          icon={Layers}
          isLoading={statsLoading}
        />
        <StatCard
          title="Total Events"
          value={stats?.total_events?.toLocaleString() ?? '0'}
          icon={Activity}
          isLoading={statsLoading}
        />
        <StatCard
          title="Alerts"
          value={stats?.total_alerts ?? 0}
          icon={AlertTriangle}
          isLoading={statsLoading}
        />
        <StatCard
          title="Blocked Actions"
          value={stats?.blocked_actions ?? 0}
          icon={ShieldX}
          isLoading={statsLoading}
        />
        <StatCard
          title="Endpoints"
          value={stats?.endpoint_count ?? 0}
          icon={Monitor}
          isLoading={statsLoading}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Events */}
        <div className="lg:col-span-2 card">
          <div className="p-4 border-b border-carbon/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-display font-bold text-carbon">Recent Events</h3>
              {isFiltered && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-carbon/[0.08] text-carbon/70 dark:bg-white/[0.08] dark:text-white/60">
                  {filterLabel}
                </span>
              )}
            </div>
            <Link to="/live" className="font-mono text-xs opacity-60 hover:opacity-100 hover:text-alert-red hover:underline">
              View All
            </Link>
          </div>

          {eventsLoading ? (
            <div className="divide-y divide-carbon/[0.06]">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="px-4 py-3 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-carbon/10" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="h-4 w-16 bg-carbon/10 rounded" />
                        <div className="h-4 w-24 bg-carbon/[0.06] rounded" />
                      </div>
                      <div className="h-3 w-40 bg-carbon/[0.06] rounded" />
                    </div>
                    <div className="h-3 w-14 bg-carbon/[0.06] rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : groupedEvents.length === 0 ? (
            <div className="p-12 text-center">
              <Activity className="w-12 h-12 opacity-20 mx-auto mb-3" />
              <p className="opacity-50 font-display">
                {isFiltered ? `No events from ${filterLabel}` : 'No events recorded'}
              </p>
              <p className="opacity-40 text-sm font-mono mt-1">
                {isFiltered
                  ? 'Try selecting a different endpoint or "All Endpoints".'
                  : 'Events will appear here when agents connect'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-carbon/[0.06]">
              {groupedEvents.slice(0, 8).map((group) => {
                const Icon = categoryIcons[group.category] || Code;
                const MAX_DETAIL_LINES = 3;

                // Build detail lines: file names for groups, full text for singles
                const details: { prefix?: string; text: string }[] = [];
                if (group.count > 1) {
                  // Grouped: show short file/url names
                  for (const fp of group.filePaths) details.push({ text: baseName(fp) });
                  for (const url of group.urls) details.push({ text: url });
                } else {
                  // Single event: show full paths/commands/urls
                  for (const fp of group.filePaths) details.push({ text: fp });
                  for (const cmd of group.commands) details.push({ prefix: '$ ', text: cmd });
                  for (const url of group.urls) details.push({ text: url });
                }
                const visibleDetails = details.slice(0, MAX_DETAIL_LINES);
                const extraCount = details.length - MAX_DETAIL_LINES;

                return (
                  <div key={group.key} className="px-4 py-3 hover:bg-carbon/[0.02] transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      {/* Left: icon + content */}
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="p-1.5 rounded-lg bg-carbon/[0.06] mt-0.5 shrink-0">
                          <Icon className="w-3.5 h-3.5 opacity-50" />
                        </div>
                        <div className="min-w-0 flex-1">
                          {/* Header row */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-display font-semibold text-carbon">
                              {group.toolName}
                            </span>
                            <span className="text-[10px] font-mono opacity-40 px-1.5 py-0.5 rounded bg-carbon/[0.05]">
                              {formatCategory(group.category)}
                            </span>
                            <span className={severityBadge(group.severity)}>
                              {group.severity}
                            </span>
                            {group.count > 1 && (
                              <span className="text-[10px] font-mono font-bold bg-carbon/[0.08] text-carbon dark:bg-white/[0.1] dark:text-white/70 px-1.5 py-0.5 rounded-full tabular-nums">
                                {group.count}x
                              </span>
                            )}
                            {group.endpointLabel && !isFiltered && (
                              <span className="text-[10px] font-mono opacity-35 px-1.5 py-0.5 rounded bg-carbon/[0.06] text-carbon/50 dark:bg-white/[0.06] dark:text-white/40">
                                {group.endpointLabel}
                              </span>
                            )}
                          </div>

                          {/* Detail lines — expandable on click */}
                          {visibleDetails.length > 0 && (
                            <div className="mt-1.5 space-y-0.5">
                              {visibleDetails.map((d, i) => (
                                <ExpandableText
                                  key={i}
                                  text={d.text}
                                  prefix={d.prefix}
                                  maxChars={70}
                                  className="text-xs font-mono opacity-50"
                                />
                              ))}
                              {extraCount > 0 && (
                                <p className="text-xs font-mono opacity-35">
                                  +{extraCount} more
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: timestamp */}
                      <span className="text-xs font-mono opacity-40 whitespace-nowrap shrink-0 mt-0.5">
                        {formatTime(group.newestTimestamp)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Alerts by Severity */}
        <div className="card">
          <div className="p-4 border-b border-carbon/10 flex items-center justify-between">
            <h3 className="text-lg font-display font-bold text-carbon">Alerts by Severity</h3>
            <Link to="/alerts" className="font-mono text-xs opacity-60 hover:opacity-100 hover:text-alert-red hover:underline">
              View All
            </Link>
          </div>
          <div className="p-4 space-y-3">
            {statsLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-carbon/10" />
                        <div className="h-3.5 w-14 bg-carbon/10 rounded" />
                      </div>
                      <div className="h-3.5 w-6 bg-carbon/10 rounded" />
                    </div>
                    <div className="h-1.5 bg-carbon/[0.06] rounded-full" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {(() => {
                  const items = [
                    { severity: 'critical', label: 'Critical', color: 'bg-[#D90429]' },
                    { severity: 'high', label: 'High', color: 'bg-[#C4516C]' },
                    { severity: 'medium', label: 'Medium', color: 'bg-[#8B8B8B]' },
                    { severity: 'low', label: 'Low', color: 'bg-[#C8C8C8]' },
                  ];
                  const maxCount = Math.max(
                    1,
                    ...items.map((i) => stats?.alerts_by_severity?.[i.severity] ?? 0)
                  );
                  return items.map((item) => {
                    const count = stats?.alerts_by_severity?.[item.severity] ?? 0;
                    const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                    return (
                      <Link
                        key={item.label}
                        to={`/alerts?severity=${item.severity}`}
                        className="block group"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className={cn('w-2.5 h-2.5 rounded-full', item.color)} />
                            <span className="text-sm font-display opacity-60 group-hover:opacity-100 group-hover:text-alert-red transition-colors">
                              {item.label}
                            </span>
                          </div>
                          <span className="text-sm font-mono font-bold text-carbon tabular-nums">
                            {count}
                          </span>
                        </div>
                        <div className="h-1.5 bg-carbon/[0.06] rounded-full overflow-hidden">
                          <div
                            className={cn('h-full rounded-full transition-all duration-500', item.color)}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </Link>
                    );
                  });
                })()}
              </>
            )}
          </div>

          {/* Recent Alerts */}
          <div className="border-t">
            <div className="p-4 border-b border-carbon/10">
              <h4 className="text-sm font-display font-semibold opacity-60">Recent Alerts</h4>
            </div>
            {filteredRecentAlerts.length > 0 ? (
              <div className="divide-y divide-carbon/[0.06]">
                {filteredRecentAlerts.slice(0, 3).map((alert) => {
                  const epLabel = sessionEndpointMap.get(alert.session_id);
                  return (
                    <Link
                      key={alert.id}
                      to={`/alerts`}
                      className="block px-4 py-3 hover:bg-carbon/[0.02] transition-colors"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className={cn(
                          'w-2 h-2 rounded-full mt-1.5 shrink-0',
                          alert.severity === 'critical' ? 'bg-[#D90429]' :
                          alert.severity === 'high' ? 'bg-[#C4516C]' :
                          alert.severity === 'medium' ? 'bg-[#8B8B8B]' : 'bg-[#C8C8C8]'
                        )} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-display text-carbon truncate">{alert.title}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className={severityBadge(alert.severity)}>
                              {alert.severity}
                            </span>
                            {epLabel && !isFiltered && (
                              <span className="text-[10px] font-mono opacity-35 px-1 py-0.5 rounded bg-carbon/[0.06] text-carbon/50 dark:bg-white/[0.06] dark:text-white/40">
                                {epLabel}
                              </span>
                            )}
                            <span className="text-[10px] font-mono opacity-35">{formatTime(alert.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center">
                <AlertTriangle className="w-8 h-8 opacity-15 mx-auto mb-2" />
                <p className="opacity-40 text-sm font-mono">
                  {isFiltered ? `No alerts for ${filterLabel}` : 'No alerts yet'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Sessions */}
        <div className="card">
          <div className="p-4 border-b border-carbon/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-display font-bold text-carbon">Active Sessions</h3>
              {isFiltered && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-carbon/[0.08] text-carbon/70 dark:bg-white/[0.08] dark:text-white/60">
                  {filterLabel}
                </span>
              )}
            </div>
            <Link to="/sessions" className="font-mono text-xs opacity-60 hover:opacity-100 hover:text-alert-red hover:underline">
              View All
            </Link>
          </div>

          {sessionsLoading ? (
            <div className="space-y-3 p-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse p-3 rounded border border-carbon/10">
                  <div className="h-4 w-40 bg-carbon/10 rounded mb-2" />
                  <div className="h-3 w-24 bg-carbon/[0.06] rounded" />
                </div>
              ))}
            </div>
          ) : activeSessions.length === 0 ? (
            <div className="p-12 text-center">
              <Layers className="w-10 h-10 opacity-20 mx-auto mb-2" />
              <p className="opacity-40 text-sm font-mono">
                {isFiltered ? `No active sessions for ${filterLabel}` : 'No active sessions'}
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {activeSessions.slice(0, 5).map((session) => (
                <Link
                  key={session.id}
                  to={`/sessions/${session.session_id}`}
                  className="block p-3 rounded-xl bg-carbon/[0.03] hover:bg-carbon/[0.06] transition-colors group"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-mono font-bold text-carbon truncate group-hover:text-alert-red transition-colors">
                            {session.cwd?.split('/').pop() || session.session_id.slice(0, 12)}
                          </p>
                          <SourceBadge source={session.session_source} />
                        </div>
                        <p className="text-[10px] font-mono opacity-40 truncate mt-0.5">
                          {session.endpoint_user
                            ? `${session.endpoint_user}@${session.endpoint_hostname || '?'}`
                            : session.session_id.slice(0, 16)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[11px] font-mono text-carbon/50">{session.event_count} evts</span>
                      {session.alert_count > 0 && (
                        <span className="text-[10px] font-mono font-bold text-[#D90429] bg-[#D90429]/10 px-1.5 py-0.5 rounded-full">{session.alert_count}</span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Events by Category */}
        <div className="card">
          <div className="p-4 border-b border-carbon/10 flex items-center justify-between">
            <h3 className="text-lg font-display font-bold text-carbon">Events by Category</h3>
            <Link to="/analytics" className="font-mono text-xs opacity-60 hover:opacity-100 hover:text-alert-red hover:underline">
              Analytics
            </Link>
          </div>
          <div className="p-5">
            {statsLoading ? (
              <div className="flex items-center gap-6">
                <div className="w-[140px] h-[140px] rounded-full border-[10px] border-carbon/10 animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center gap-2 animate-pulse">
                      <div className="w-2 h-2 rounded-full bg-carbon/10" />
                      <div className="h-3 w-20 bg-carbon/10 rounded" />
                      <div className="flex-1 h-3 bg-carbon/[0.06] rounded-full" />
                      <div className="h-3 w-10 bg-carbon/10 rounded" />
                    </div>
                  ))}
                </div>
              </div>
            ) : stats?.events_by_category ? (
              (() => {
                const sorted = Object.entries(stats.events_by_category)
                  .filter(([, count]) => count > 0)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 7);
                const total = sorted.reduce((sum, [, c]) => sum + c, 0);
                const maxCount = sorted.length > 0 ? sorted[0][1] : 1;
                const segments = buildDonutSegments(sorted, total, isDark);

                return (
                  <div className="flex items-center gap-6">
                    {/* Mini Donut */}
                    <div className="relative w-[140px] h-[140px] flex-shrink-0">
                      <svg viewBox="0 0 100 100" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
                        {segments.map((seg) => (
                          <circle
                            key={seg.category}
                            cx="50"
                            cy="50"
                            r="38"
                            fill="none"
                            stroke={seg.color}
                            strokeWidth="10"
                            strokeDasharray={seg.dashArray}
                            strokeDashoffset={seg.dashOffset}
                          />
                        ))}
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-xl font-bold text-carbon">{total.toLocaleString()}</span>
                        <span className="text-[9px] font-mono opacity-40 uppercase">events</span>
                      </div>
                    </div>

                    {/* Bars */}
                    <div className="flex-1 space-y-1.5">
                      {sorted.map(([category, count]) => {
                        const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                        const colors = CATEGORY_COLORS[category] || { light: '#d0d0d0', dark: '#3a3a3a' };
                        const dotColor = isDark ? colors.dark : colors.light;

                        return (
                          <div key={category} className="flex items-center gap-2">
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: dotColor }}
                            />
                            <span className="text-xs opacity-50 w-[90px] truncate flex-shrink-0">
                              {formatCategory(category)}
                            </span>
                            <div className="flex-1 h-3 bg-carbon/[0.04] rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%`, backgroundColor: dotColor }}
                              />
                            </div>
                            <span className="text-xs font-mono font-bold text-carbon w-10 text-right tabular-nums">
                              {count.toLocaleString()}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="h-48 flex items-center justify-center">
                <p className="opacity-40 text-sm font-mono">No event data available</p>
              </div>
            )}
          </div>
        </div>

        {/* Sessions by Source */}
        <div className="card">
          <div className="p-4 border-b border-carbon/10">
            <h3 className="text-lg font-display font-bold text-carbon">Sessions by Source</h3>
          </div>
          <div className="p-5">
            {statsLoading ? (
              <div className="flex items-center gap-6">
                <div className="w-[140px] h-[140px] rounded-full border-[10px] border-carbon/10 animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-3">
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className="flex items-center gap-2 animate-pulse">
                      <div className="w-2 h-2 rounded-full bg-carbon/10" />
                      <div className="h-3 w-20 bg-carbon/10 rounded" />
                      <div className="flex-1 h-3 bg-carbon/[0.06] rounded-full" />
                      <div className="h-3 w-10 bg-carbon/10 rounded" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (() => {
              const sourceData = stats?.sessions_by_source || {};
              const entries = Object.entries(sourceData).sort(([, a], [, b]) => b - a);
              const total = entries.reduce((sum, [, c]) => sum + c, 0);

              if (total === 0) {
                return (
                  <div className="h-48 flex items-center justify-center">
                    <p className="opacity-40 text-sm font-mono">No session data available</p>
                  </div>
                );
              }

              const SOURCE_COLORS: Record<string, { light: string; dark: string }> = {
                claude_code: { light: '#1A1A1A', dark: '#ececec' },
                cursor: { light: '#888888', dark: '#777777' },
              };
              const maxCount = entries.length > 0 ? entries[0][1] : 1;

              const circumference = 2 * Math.PI * 38;
              let offset = 0;
              const segments = entries.map(([source, count]) => {
                const pct = total > 0 ? count / total : 0;
                const arcLen = pct * circumference;
                const gap = circumference - arcLen;
                const colors = SOURCE_COLORS[source] || { light: '#888888', dark: '#777777' };
                const color = isDark ? colors.dark : colors.light;
                const seg = { source, color, dashArray: `${arcLen} ${gap}`, dashOffset: -offset };
                offset += arcLen;
                return seg;
              });

              const formatSource = (s: string) => s === 'cursor' ? 'Cursor' : 'Claude Code';

              return (
                <div className="flex items-center gap-6">
                  <div className="relative w-[140px] h-[140px] flex-shrink-0">
                    <svg viewBox="0 0 100 100" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
                      {segments.map((seg) => (
                        <circle
                          key={seg.source}
                          cx="50"
                          cy="50"
                          r="38"
                          fill="none"
                          stroke={seg.color}
                          strokeWidth="10"
                          strokeDasharray={seg.dashArray}
                          strokeDashoffset={seg.dashOffset}
                        />
                      ))}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-bold text-carbon">{total.toLocaleString()}</span>
                      <span className="text-[9px] font-mono opacity-40 uppercase">sessions</span>
                    </div>
                  </div>

                  <div className="flex-1 space-y-1.5">
                    {entries.map(([source, count]) => {
                      const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                      const colors = SOURCE_COLORS[source] || { light: '#888888', dark: '#777777' };
                      const dotColor = isDark ? colors.dark : colors.light;

                      return (
                        <div key={source} className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: dotColor }}
                          />
                          <span className="text-xs opacity-50 w-[90px] truncate flex-shrink-0">
                            {formatSource(source)}
                          </span>
                          <div className="flex-1 h-3 bg-carbon/[0.04] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${pct}%`, backgroundColor: dotColor }}
                            />
                          </div>
                          <span className="text-xs font-mono font-bold text-carbon w-10 text-right tabular-nums">
                            {count.toLocaleString()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
