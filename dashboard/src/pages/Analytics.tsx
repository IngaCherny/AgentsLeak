import { useState, useMemo } from 'react';
import {
  TrendingUp,
  Download,
  RefreshCw,
  Monitor,
  X,
  Cpu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDarkMode } from '@/lib/useDarkMode';
import { useStats, useTimeline, useSessions, useTopFiles, useTopCommands, useTopDomains, useEndpointStats } from '@/api/queries';
import EventsOverTime from '@/components/charts/EventsOverTime';

type TimeRange = '1h' | '24h' | '7d' | '30d';

function getDateRange(range: TimeRange): { start: string; end: string; interval: 'minute' | 'hour' | 'day' } {
  const end = new Date();
  const start = new Date();

  switch (range) {
    case '1h':
      start.setHours(start.getHours() - 1);
      return { start: start.toISOString(), end: end.toISOString(), interval: 'minute' };
    case '24h':
      start.setDate(start.getDate() - 1);
      return { start: start.toISOString(), end: end.toISOString(), interval: 'hour' };
    case '7d':
      start.setDate(start.getDate() - 7);
      return { start: start.toISOString(), end: end.toISOString(), interval: 'hour' };
    case '30d':
      start.setDate(start.getDate() - 30);
      return { start: start.toISOString(), end: end.toISOString(), interval: 'day' };
    default:
      start.setDate(start.getDate() - 1);
      return { start: start.toISOString(), end: end.toISOString(), interval: 'hour' };
  }
}

// ── Rank-based monochrome palette for donut+bars (darkest → lightest) ────

const RANK_COLORS_LIGHT = ['#1A1A1A', '#444444', '#777777', '#aaaaaa', '#cccccc'];
const RANK_COLORS_DARK  = ['#ececec', '#aaaaaa', '#777777', '#555555', '#3a3a3a'];
const COMMAND_ACCENT    = '#D90429';

const CATEGORY_COLORS: Record<string, { light: string; dark: string }> = {
  command_exec:      { light: '#D90429', dark: '#D90429' },
  file_read:         { light: '#1A1A1A', dark: '#ececec' },
  file_write:        { light: '#555555', dark: '#aaaaaa' },
  network_access:    { light: '#888888', dark: '#777777' },
  code_execution:    { light: '#b0b0b0', dark: '#555555' },
  file_delete:       { light: '#d0d0d0', dark: '#3a3a3a' },
  subagent_spawn:    { light: '#e8e8e8', dark: '#2a2a2a' },
  mcp_tool_use:      { light: '#e0e0e0', dark: '#333333' },
  session_lifecycle:  { light: '#eeeeee', dark: '#222222' },
};

function buildCategoryDonutSegments(
  entries: [string, number][],
  total: number,
  isDark: boolean,
): { category: string; color: string; dashArray: string; dashOffset: number }[] {
  const circumference = 2 * Math.PI * 38;
  let offset = 0;
  return entries.map(([category, count]) => {
    const pct = total > 0 ? count / total : 0;
    const arcLen = pct * circumference;
    const gap = circumference - arcLen;
    const colors = CATEGORY_COLORS[category] || { light: '#d0d0d0', dark: '#3a3a3a' };
    const color = isDark ? colors.dark : colors.light;
    const segment = { category, color, dashArray: `${arcLen} ${gap}`, dashOffset: -offset };
    offset += arcLen;
    return segment;
  });
}

function formatCategory(category: string): string {
  return category.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

/** Build SVG donut segments from a ranked list of { label, count }. */
function buildRankedDonutSegments(
  items: { label: string; count: number }[],
  total: number,
  isDark: boolean,
  accentFirst = false,
): { label: string; color: string; dashArray: string; dashOffset: number }[] {
  const circumference = 2 * Math.PI * 38; // r=38
  let offset = 0;
  return items.map(({ label, count }, i) => {
    const pct = total > 0 ? count / total : 0;
    const arcLen = pct * circumference;
    const gap = circumference - arcLen;
    const palette = isDark ? RANK_COLORS_DARK : RANK_COLORS_LIGHT;
    const color = accentFirst && i === 0
      ? COMMAND_ACCENT
      : palette[Math.min(i, palette.length - 1)];
    const segment = { label, color, dashArray: `${arcLen} ${gap}`, dashOffset: -offset };
    offset += arcLen;
    return segment;
  });
}

function shortenPath(fullPath: string, maxLen = 28): string {
  if (fullPath.length <= maxLen) return fullPath;
  const parts = fullPath.split('/');
  const filename = parts[parts.length - 1] || parts[parts.length - 2] || fullPath;
  if (filename.length > maxLen) return '...' + filename.slice(-maxLen + 3);
  return '.../' + filename;
}

function shortenCommand(cmd: string, maxLen = 28): string {
  if (cmd.length <= maxLen) return cmd;
  return cmd.slice(0, maxLen - 3) + '...';
}

const analyticsCardConfig: Record<string, { icon: React.ElementType; iconBg: string; iconColor: string; valueColor: string }> = {
  'Total Events': { icon: TrendingUp, iconBg: 'bg-carbon/[0.08]', iconColor: 'text-carbon/60', valueColor: 'text-carbon' },
  'Active Sessions': { icon: TrendingUp, iconBg: 'bg-green-500/[0.12]', iconColor: 'text-green-500', valueColor: 'text-green-600' },
  'New Alerts': { icon: TrendingUp, iconBg: 'bg-amber-500/[0.12]', iconColor: 'text-amber-500', valueColor: 'text-severity-medium' },
  'Blocked Actions': { icon: TrendingUp, iconBg: 'bg-[#D90429]/[0.12]', iconColor: 'text-[#D90429]', valueColor: 'text-severity-critical' },
};

function StatCard({
  label,
  value,
  change,
  isLoading,
}: {
  label: string;
  value: string | number;
  change?: string;
  isLoading?: boolean;
}) {
  const config = analyticsCardConfig[label] || analyticsCardConfig['Total Events'];
  const Icon = config.icon;
  const isPositive = change?.startsWith('+');

  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={cn('w-10 h-10 rounded-[10px] flex items-center justify-center flex-shrink-0', config.iconBg)}>
        <Icon className={cn('w-5 h-5', config.iconColor)} />
      </div>
      <div className="flex-1">
        {isLoading ? (
          <div className="h-7 w-16 bg-carbon/[0.04] rounded animate-pulse" />
        ) : (
          <div className="flex items-end justify-between">
            <p className={cn('text-xl font-bold', config.valueColor)}>{value}</p>
            {change && (
              <span className={cn('text-xs font-medium', isPositive ? 'text-green-600' : 'text-severity-critical')}>
                {change}
              </span>
            )}
          </div>
        )}
        <p className="text-[10px] font-mono opacity-40 uppercase">{label}</p>
      </div>
    </div>
  );
}

export default function Analytics() {
  const isDark = useDarkMode();
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [endpointFilter, setEndpointFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  const { start, end, interval } = useMemo(() => getDateRange(timeRange), [timeRange]);

  const { data: endpointData } = useEndpointStats();
  const endpoints = useMemo(() => {
    const items = endpointData?.items || [];
    const unique = new Map<string, { hostname: string; user: string | null; label: string }>();
    for (const ep of items) {
      const key = `${ep.endpoint_user || ''}@${ep.endpoint_hostname || 'unknown'}`;
      const label = ep.endpoint_user
        ? `${ep.endpoint_user}@${ep.endpoint_hostname || '?'}`
        : ep.endpoint_hostname || 'unknown';
      if (!unique.has(key)) {
        unique.set(key, { hostname: ep.endpoint_hostname || 'unknown', user: ep.endpoint_user, label });
      }
    }
    return Array.from(unique.values());
  }, [endpointData]);

  const activeEndpoint = endpointFilter !== 'all' ? endpointFilter : undefined;
  const activeSource = sourceFilter !== 'all' ? sourceFilter : undefined;
  const sessionFilters = {
    ...(activeEndpoint ? { endpoint: activeEndpoint } : {}),
    ...(activeSource ? { session_source: activeSource } : {}),
  };
  const hasSessionFilters = Object.keys(sessionFilters).length > 0;

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useStats(start, end, activeEndpoint);
  const { data: timeline, isLoading: timelineLoading } = useTimeline(start, end, interval, undefined, activeEndpoint);
  const { data: sessionsData, isLoading: sessionsLoading } = useSessions(hasSessionFilters ? sessionFilters : undefined, 1, 100);
  const { data: topFilesData, isLoading: topFilesLoading } = useTopFiles(10, start, end, activeEndpoint);
  const { data: topCommandsData, isLoading: topCommandsLoading } = useTopCommands(10, start, end, activeEndpoint);
  const { data: topDomainsData, isLoading: topDomainsLoading } = useTopDomains(10, start, end, activeEndpoint);

  const sessions = useMemo(() => sessionsData?.items || [], [sessionsData]);

  const topFiles = useMemo(() =>
    (topFilesData?.items || []).slice(0, 5).map((f) => ({
      path: f.file_path,
      count: f.total_access,
    })),
    [topFilesData]
  );

  const topCommands = useMemo(() =>
    (topCommandsData?.items || []).slice(0, 5).map((c) => ({
      command: c.command,
      count: c.execution_count,
    })),
    [topCommandsData]
  );

  const topDomains = useMemo(() =>
    (topDomainsData?.items || []).slice(0, 5).map((d) => ({
      domain: d.hostname,
      count: d.access_count,
    })),
    [topDomainsData]
  );

  // Calculate session activity (already filtered by endpoint via the query)
  const sessionActivity = useMemo(() => {
    return sessions
      .sort((a, b) => b.event_count - a.event_count)
      .slice(0, 5)
      .map((session) => ({
        name: session.endpoint_user
          ? `${session.endpoint_user}: ${session.cwd?.split('/').pop() || session.session_id.slice(0, 8)}`
          : session.cwd?.split('/').pop() || session.session_id.slice(0, 12),
        sessions: 1,
        events: session.event_count,
        alerts: session.alert_count,
      }));
  }, [sessions]);

  const handleRefresh = () => {
    refetchStats();
  };

  const handleExport = () => {
    const reportData = {
      generatedAt: new Date().toISOString(),
      timeRange,
      stats,
      topFiles,
      topCommands,
      topDomains,
      sessionActivity,
      timeline: timeline?.points,
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentsleak-analytics-${timeRange}-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isLoading = statsLoading || timelineLoading || sessionsLoading || topFilesLoading || topCommandsLoading;

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 bg-carbon/[0.04] rounded-full p-1">
            {(['1h', '24h', '7d', '30d'] as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={cn(
                  'px-4 py-1.5 text-sm font-medium rounded-full transition-all',
                  timeRange === range
                    ? 'bg-carbon text-white shadow-sm'
                    : 'text-carbon/50 hover:text-alert-red'
                )}
              >
                {range}
              </button>
            ))}
          </div>

          {/* Endpoint Filter */}
          {endpoints.length > 0 && (
            <div className="relative">
              <Monitor className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
              <select
                value={endpointFilter}
                onChange={(e) => setEndpointFilter(e.target.value)}
                className="input-search pl-9 pr-8 w-52 text-sm appearance-none cursor-pointer"
              >
                <option value="all">All Endpoints</option>
                {endpoints.map((ep) => (
                  <option key={ep.label} value={ep.hostname}>
                    {ep.label}
                  </option>
                ))}
              </select>
              {endpointFilter !== 'all' && (
                <button
                  onClick={() => setEndpointFilter('all')}
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
              onChange={(e) => setSourceFilter(e.target.value)}
              className="input-search pl-9 pr-8 w-44 text-sm appearance-none cursor-pointer"
            >
              <option value="all">All Sources</option>
              <option value="claude_code">Claude Code</option>
              <option value="cursor">Cursor</option>
            </select>
            {sourceFilter !== 'all' && (
              <button
                onClick={() => setSourceFilter('all')}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100 hover:text-alert-red"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="btn btn-secondary flex items-center gap-2"
          >
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
            Refresh
          </button>
          <button
            onClick={handleExport}
            className="btn btn-secondary flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export Report
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Total Events"
          value={stats?.total_events?.toLocaleString() || '0'}
          isLoading={statsLoading}
        />
        <StatCard
          label="Active Sessions"
          value={stats?.active_sessions || 0}
          isLoading={statsLoading}
        />
        <StatCard
          label="New Alerts"
          value={stats?.new_alerts || 0}
          isLoading={statsLoading}
        />
        <StatCard
          label="Blocked Actions"
          value={stats?.blocked_actions || 0}
          isLoading={statsLoading}
        />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-2 gap-6">
        {/* Events Over Time */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-medium text-carbon">Events Over Time</h3>
              {timeline && (
                <p className="text-xs font-mono opacity-40 mt-1">
                  {timeline.total_events} events · {timeline.total_alerts} alerts
                </p>
              )}
            </div>
            <TrendingUp className="w-5 h-5 opacity-40" />
          </div>
          <EventsOverTime
            data={timeline}
            isLoading={timelineLoading}
            interval={interval}
          />
        </div>

        {/* Events by Category */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-carbon">Events by Category</h3>
          </div>
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
              const segments = buildCategoryDonutSegments(sorted, total, isDark);

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
            <div className="h-64 flex items-center justify-center border-dashed border">
              <p className="opacity-40">No category data available</p>
            </div>
          )}
        </div>

        {/* Top Accessed Files */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-carbon">Top Accessed Files</h3>
          </div>
          {topFilesLoading ? (
            <div className="flex items-center gap-6">
              <div className="w-[140px] h-[140px] rounded-full border-[10px] border-carbon/10 animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-2 animate-pulse">
                    <div className="w-2 h-2 rounded-full bg-carbon/10" />
                    <div className="h-3 w-24 bg-carbon/10 rounded" />
                    <div className="flex-1 h-3 bg-carbon/[0.06] rounded-full" />
                    <div className="h-3 w-10 bg-carbon/10 rounded" />
                  </div>
                ))}
              </div>
            </div>
          ) : topFiles.length > 0 ? (
            (() => {
              const total = topFiles.reduce((sum, f) => sum + f.count, 0);
              const maxCount = topFiles[0]?.count || 1;
              const segments = buildRankedDonutSegments(
                topFiles.map((f) => ({ label: f.path, count: f.count })),
                total,
                isDark,
              );

              return (
                <div className="flex items-center gap-6">
                  {/* Mini Donut */}
                  <div className="relative w-[140px] h-[140px] flex-shrink-0">
                    <svg viewBox="0 0 100 100" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
                      {segments.map((seg) => (
                        <circle
                          key={seg.label}
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
                      <span className="text-[9px] font-mono opacity-40 uppercase">accesses</span>
                    </div>
                  </div>

                  {/* Bars */}
                  <div className="flex-1 space-y-1.5">
                    {topFiles.map((f, i) => {
                      const pct = maxCount > 0 ? (f.count / maxCount) * 100 : 0;
                      const palette = isDark ? RANK_COLORS_DARK : RANK_COLORS_LIGHT;
                      const dotColor = palette[Math.min(i, palette.length - 1)];

                      return (
                        <div key={f.path} className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: dotColor }}
                          />
                          <span className="text-xs opacity-50 w-[110px] truncate flex-shrink-0" title={f.path}>
                            {shortenPath(f.path)}
                          </span>
                          <div className="flex-1 h-3 bg-carbon/[0.04] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${pct}%`, backgroundColor: dotColor }}
                            />
                          </div>
                          <span className="text-xs font-mono font-bold text-carbon w-10 text-right tabular-nums">
                            {f.count.toLocaleString()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="h-48 flex items-center justify-center border-dashed border">
              <p className="opacity-40">No file access data</p>
            </div>
          )}
        </div>

        {/* Top Commands */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-carbon">Top Commands</h3>
          </div>
          {topCommandsLoading ? (
            <div className="flex items-center gap-6">
              <div className="w-[140px] h-[140px] rounded-full border-[10px] border-carbon/10 animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-2 animate-pulse">
                    <div className="w-2 h-2 rounded-full bg-carbon/10" />
                    <div className="h-3 w-24 bg-carbon/10 rounded" />
                    <div className="flex-1 h-3 bg-carbon/[0.06] rounded-full" />
                    <div className="h-3 w-10 bg-carbon/10 rounded" />
                  </div>
                ))}
              </div>
            </div>
          ) : topCommands.length > 0 ? (
            (() => {
              const total = topCommands.reduce((sum, c) => sum + c.count, 0);
              const maxCount = topCommands[0]?.count || 1;
              const segments = buildRankedDonutSegments(
                topCommands.map((c) => ({ label: c.command, count: c.count })),
                total,
                isDark,
                true, // accent first — red for top command (risky)
              );

              return (
                <div className="flex items-center gap-6">
                  {/* Mini Donut */}
                  <div className="relative w-[140px] h-[140px] flex-shrink-0">
                    <svg viewBox="0 0 100 100" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
                      {segments.map((seg) => (
                        <circle
                          key={seg.label}
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
                      <span className="text-[9px] font-mono opacity-40 uppercase">runs</span>
                    </div>
                  </div>

                  {/* Bars */}
                  <div className="flex-1 space-y-1.5">
                    {topCommands.map((c, i) => {
                      const pct = maxCount > 0 ? (c.count / maxCount) * 100 : 0;
                      const palette = isDark ? RANK_COLORS_DARK : RANK_COLORS_LIGHT;
                      const dotColor = i === 0 ? COMMAND_ACCENT : palette[Math.min(i, palette.length - 1)];

                      return (
                        <div key={c.command} className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: dotColor }}
                          />
                          <span className="text-xs opacity-50 w-[110px] truncate flex-shrink-0 font-mono" title={c.command}>
                            {shortenCommand(c.command)}
                          </span>
                          <div className="flex-1 h-3 bg-carbon/[0.04] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${pct}%`, backgroundColor: dotColor }}
                            />
                          </div>
                          <span className="text-xs font-mono font-bold text-carbon w-10 text-right tabular-nums">
                            {c.count.toLocaleString()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="h-48 flex items-center justify-center border-dashed border">
              <p className="opacity-40">No command data</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom row — Domains + Sessions + Source */}
      <div className="grid grid-cols-3 gap-6">

        {/* Top Network Domains */}
        <div className="card p-5 overflow-hidden">
          <h3 className="font-medium text-carbon text-sm mb-4">Top Network Domains</h3>
          {topDomainsLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-2 animate-pulse">
                  <div className="w-2 h-2 rounded-full bg-carbon/10" />
                  <div className="h-3 w-24 bg-carbon/10 rounded" />
                  <div className="flex-1 h-3 bg-carbon/[0.06] rounded-full" />
                  <div className="h-3 w-8 bg-carbon/10 rounded" />
                </div>
              ))}
            </div>
          ) : topDomains.length > 0 ? (
            (() => {
              const total = topDomains.reduce((sum, d) => sum + d.count, 0);
              const maxCount = topDomains[0]?.count || 1;

              return (
                <div className="space-y-2">
                  <p className="text-[10px] font-mono opacity-40 mb-3">{total.toLocaleString()} total requests</p>
                  {topDomains.map((d, i) => {
                    const pct = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
                    const palette = isDark ? RANK_COLORS_DARK : RANK_COLORS_LIGHT;
                    const dotColor = palette[Math.min(i, palette.length - 1)];

                    return (
                      <div key={d.domain}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: dotColor }}
                            />
                            <span className="text-xs opacity-50 truncate" title={d.domain}>
                              {d.domain}
                            </span>
                          </div>
                          <span className="text-xs font-mono font-bold text-carbon tabular-nums ml-2 flex-shrink-0">
                            {d.count.toLocaleString()}
                          </span>
                        </div>
                        <div className="h-1.5 bg-carbon/[0.04] rounded-full overflow-hidden ml-4">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, backgroundColor: dotColor }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          ) : (
            <div className="h-32 flex items-center justify-center">
              <p className="opacity-40 text-sm">No network request data</p>
            </div>
          )}
        </div>

        {/* Top Sessions by Activity */}
        <div className="card p-5 overflow-hidden">
          <h3 className="font-medium text-carbon text-sm mb-4">Top Sessions by Activity</h3>
          {sessionsLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-2 animate-pulse">
                  <div className="w-2 h-2 rounded-full bg-carbon/10" />
                  <div className="h-3 w-24 bg-carbon/10 rounded" />
                  <div className="flex-1 h-3 bg-carbon/[0.06] rounded-full" />
                  <div className="h-3 w-8 bg-carbon/10 rounded" />
                </div>
              ))}
            </div>
          ) : sessionActivity.length > 0 ? (
            (() => {
              const totalEvents = sessionActivity.reduce((sum, s) => sum + s.events, 0);
              const maxEvents = sessionActivity[0]?.events || 1;
              const palette = isDark ? RANK_COLORS_DARK : RANK_COLORS_LIGHT;
              const itemColors = sessionActivity.map((s, i) =>
                s.alerts > 0 ? COMMAND_ACCENT : palette[Math.min(i, palette.length - 1)]
              );

              return (
                <div className="space-y-2">
                  <p className="text-[10px] font-mono opacity-40 mb-3">{totalEvents.toLocaleString()} total events</p>
                  {sessionActivity.map((s, i) => {
                    const pct = maxEvents > 0 ? (s.events / maxEvents) * 100 : 0;
                    const dotColor = itemColors[i];

                    return (
                      <div key={s.name}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: dotColor }}
                            />
                            <span className="text-xs opacity-50 truncate" title={s.name}>
                              {s.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <span className="text-xs font-mono font-bold text-carbon tabular-nums">
                              {s.events.toLocaleString()}
                            </span>
                            {s.alerts > 0 && (
                              <span className="text-[9px] font-mono font-bold text-[#D90429] tabular-nums">
                                {s.alerts}!
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="h-1.5 bg-carbon/[0.04] rounded-full overflow-hidden ml-4">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, backgroundColor: dotColor }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          ) : (
            <div className="h-32 flex items-center justify-center">
              <p className="opacity-40 text-sm">No session activity data</p>
            </div>
          )}
        </div>

        {/* Sessions by Source */}
        <div className="card p-5 overflow-hidden">
          <h3 className="font-medium text-carbon text-sm mb-4">Sessions by Source</h3>
          {statsLoading ? (
            <div className="space-y-3">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="flex items-center gap-2 animate-pulse">
                  <div className="w-2 h-2 rounded-full bg-carbon/10" />
                  <div className="h-3 w-20 bg-carbon/10 rounded" />
                  <div className="flex-1 h-3 bg-carbon/[0.06] rounded-full" />
                  <div className="h-3 w-8 bg-carbon/10 rounded" />
                </div>
              ))}
            </div>
          ) : (() => {
            const sourceData = stats?.sessions_by_source || {};
            const entries = Object.entries(sourceData).sort(([, a], [, b]) => b - a);
            const total = entries.reduce((sum, [, c]) => sum + c, 0);

            if (total === 0) {
              return (
                <div className="h-32 flex items-center justify-center">
                  <p className="opacity-40 text-sm">No source data in this time range</p>
                </div>
              );
            }

            const SOURCE_COLORS: Record<string, { light: string; dark: string }> = {
              claude_code: { light: '#1A1A1A', dark: '#ececec' },
              cursor: { light: '#888888', dark: '#777777' },
            };
            const maxCount = entries.length > 0 ? entries[0][1] : 1;
            const formatSource = (s: string) => s === 'cursor' ? 'Cursor' : 'Claude Code';

            return (
              <div className="space-y-2">
                <p className="text-[10px] font-mono opacity-40 mb-3">{total.toLocaleString()} total sessions</p>
                {entries.map(([source, count]) => {
                  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                  const colors = SOURCE_COLORS[source] || { light: '#888888', dark: '#777777' };
                  const dotColor = isDark ? colors.dark : colors.light;

                  return (
                    <div key={source}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: dotColor }}
                          />
                          <span className="text-xs opacity-50">
                            {formatSource(source)}
                          </span>
                        </div>
                        <span className="text-xs font-mono font-bold text-carbon tabular-nums ml-2 flex-shrink-0">
                          {count.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-1.5 bg-carbon/[0.04] rounded-full overflow-hidden ml-4">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: dotColor }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
