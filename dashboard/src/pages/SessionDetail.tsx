import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  Activity,
  AlertTriangle,
  Folder,
  Terminal,
  Monitor,
  XCircle,
  FileText,
  Globe,
  Loader2,
  X,
  Maximize2,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession, useSessionEvents, useSessionAlerts, useTerminateSession, useTimeline } from '@/api/queries';
import { EventCard, EventCardSkeleton, AggregatedEventCard } from '@/components/events/EventCard';
import { aggregateEvents } from '@/components/events/aggregateEvents';
import { AlertCard, AlertCardSkeleton } from '@/components/alerts/AlertCard';
import { TimeAgo } from '@/components/common/TimeAgo';
import { EventCategory, Severity } from '@/api/types';
import { SessionGraph } from '@/components/graph';
import EventsOverTime from '@/components/charts/EventsOverTime';

type TabType = 'timeline' | 'events' | 'alerts' | 'files' | 'commands' | 'network' | 'graph';

const statusStyles: Record<string, { bg: string; text: string; border: string }> = {
  active: {
    bg: 'bg-green-50',
    text: 'text-green-600',
    border: 'border-green-200',
  },
  ended: {
    bg: 'bg-carbon/[0.04]',
    text: 'opacity-50',
    border: 'border',
  },
};

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabType>('timeline');
  const [eventsPage, setEventsPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState<EventCategory | ''>('');
  const [severityFilter, setSeverityFilter] = useState<Severity | ''>('');
  const [logSearch, setLogSearch] = useState('');

  const { data: session, isLoading: sessionLoading, error: sessionError } = useSession(id || '');
  const {
    data: eventsData,
    isLoading: eventsLoading,
    isFetching: eventsFetching
  } = useSessionEvents(
    id || '',
    { category: categoryFilter || undefined, severity: severityFilter || undefined },
    eventsPage,
    50
  );
  const { data: alertsData, isLoading: alertsLoading } = useSessionAlerts(id || '', undefined, 1, 50);

  const terminateMutation = useTerminateSession();

  // Session timeline — use actual event time range, auto-pick interval
  const sessionTimelineParams = useMemo(() => {
    if (!session) return { start: '', end: '', interval: 'minute' as const };

    // Use actual event timestamps if available, fall back to session metadata
    const startCandidates = [new Date(session.started_at)];
    if (session.first_event_at) startCandidates.push(new Date(session.first_event_at));
    const start = new Date(Math.min(...startCandidates.map((d) => d.getTime())));

    const endCandidates = [new Date()];
    if (session.ended_at) endCandidates.push(new Date(session.ended_at));
    if (session.last_event_at) endCandidates.push(new Date(session.last_event_at));
    const end = new Date(Math.max(...endCandidates.map((d) => d.getTime())));

    const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

    let interval: 'minute' | 'hour' | 'day' = 'minute';
    if (durationHours > 2) interval = 'hour';
    if (durationHours > 24 * 7) interval = 'day';

    return { start: start.toISOString(), end: end.toISOString(), interval };
  }, [session]);

  const { data: sessionTimeline, isLoading: timelineLoading } = useTimeline(
    sessionTimelineParams.start,
    sessionTimelineParams.end,
    sessionTimelineParams.interval,
    session?.session_id
  );

  const events = useMemo(() => eventsData?.items || [], [eventsData]);
  const alerts = useMemo(() => alertsData?.items || [], [alertsData]);

  // Client-side search filter for event log
  const filteredLogEvents = useMemo(() => {
    if (!logSearch) return events;
    const q = logSearch.toLowerCase();
    return events.filter((e) => {
      const tool = (e.tool_name || '').toLowerCase();
      const files = (e.file_paths || []).join(' ').toLowerCase();
      const cmds = (e.commands || []).join(' ').toLowerCase();
      const urls = (e.urls || []).join(' ').toLowerCase();
      const cat = (e.category || '').toLowerCase();
      return tool.includes(q) || files.includes(q) || cmds.includes(q) || urls.includes(q) || cat.includes(q);
    });
  }, [events, logSearch]);

  // Aggregate events for the event log (group same file/command/url)
  const aggregatedLogEvents = useMemo(
    () => aggregateEvents(filteredLogEvents),
    [filteredLogEvents]
  );

  // Filter events for specific tabs (must be before early returns — React hook rules)
  const fileEvents = useMemo(() => events.filter((e) =>
    [EventCategory.FileRead, EventCategory.FileWrite, EventCategory.FileDelete].includes(e.category as EventCategory)
  ), [events]);
  const commandEvents = useMemo(() => events.filter((e) =>
    e.category === EventCategory.CommandExec
  ), [events]);
  const networkEvents = useMemo(() => events.filter((e) =>
    e.category === EventCategory.NetworkAccess
  ), [events]);

  // Aggregated versions for each tab
  const aggregatedFileEvents = useMemo(() => aggregateEvents(fileEvents), [fileEvents]);
  const aggregatedCommandEvents = useMemo(() => aggregateEvents(commandEvents), [commandEvents]);
  const aggregatedNetworkEvents = useMemo(() => aggregateEvents(networkEvents), [networkEvents]);

  const handleTerminate = async () => {
    if (!id) return;
    if (window.confirm('Are you sure you want to terminate this session?')) {
      terminateMutation.mutate(id);
    }
  };

  const clearFilters = () => {
    setCategoryFilter('');
    setSeverityFilter('');
  };

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 opacity-40 animate-spin" />
      </div>
    );
  }

  if (sessionError || !session) {
    return (
      <div className="space-y-6">
        <Link
          to="/sessions"
          className="inline-flex items-center gap-2 opacity-50 hover:opacity-100 hover:text-alert-red transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Sessions
        </Link>
        <div className="card p-12 text-center">
          <AlertTriangle className="w-12 h-12 text-carbon mx-auto mb-4" />
          <h2 className="text-lg font-medium text-carbon mb-2">Session not found</h2>
          <p className="opacity-50">
            The session you're looking for doesn't exist or has been deleted.
          </p>
        </div>
      </div>
    );
  }

  const status = statusStyles[session.status] || statusStyles.ended;
  const displayName = session.cwd?.split('/').pop() || session.session_id.slice(0, 16);

  const tabs: { id: TabType; label: string; count?: number }[] = [
    { id: 'timeline', label: 'Timeline', count: eventsData?.total },
    { id: 'events', label: 'Events', count: eventsData?.total },
    { id: 'alerts', label: 'Alerts', count: alertsData?.total },
    { id: 'files', label: 'Files' },
    { id: 'commands', label: 'Commands' },
    { id: 'network', label: 'Network' },
    { id: 'graph', label: 'Graph' },
  ];

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link
        to="/sessions"
        className="inline-flex items-center gap-2 opacity-50 hover:opacity-100 hover:text-alert-red transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Sessions
      </Link>

      {/* Session Header */}
      <div className="card p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-[10px] bg-carbon/[0.08] flex items-center justify-center">
              <Terminal className="w-7 h-7 text-carbon/60" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-carbon">
                  {displayName}
                </h1>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full',
                    status.bg,
                    status.text,
                    status.border
                  )}
                >
                  {session.status === 'active' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  )}
                  {session.status}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <p className="opacity-40 font-mono text-sm">{session.session_id}</p>
                {(session.endpoint_user || session.endpoint_hostname) && (
                  <span className="inline-flex items-center gap-1 text-xs font-mono opacity-50 px-2 py-0.5 rounded bg-carbon/[0.05]">
                    <Monitor className="w-3 h-3" />
                    {session.endpoint_user
                      ? `${session.endpoint_user}@${session.endpoint_hostname || '?'}`
                      : session.endpoint_hostname}
                  </span>
                )}
              </div>
            </div>
          </div>

          {session.status === 'active' && (
            <button
              onClick={handleTerminate}
              disabled={terminateMutation.isPending}
              className="rounded-full bg-carbon/[0.06] hover:bg-[#D90429]/10 hover:text-[#D90429] px-4 py-2 text-sm font-semibold flex items-center gap-2 transition-colors"
            >
              {terminateMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              Terminate Session
            </button>
          )}
        </div>

        {/* Session Stats */}
        <div className="grid grid-cols-4 gap-6 mt-6 pt-6 border-t">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-carbon/[0.06] flex items-center justify-center">
              <Clock className="w-4 h-4 opacity-40" />
            </div>
            <div>
              <p className="text-xs opacity-40">Started</p>
              <p className="text-sm font-medium text-carbon">
                <TimeAgo date={session.started_at} />
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-carbon/[0.06] flex items-center justify-center">
              <Folder className="w-4 h-4 opacity-40" />
            </div>
            <div>
              <p className="text-xs opacity-40">Working Directory</p>
              <p className="text-sm font-medium text-carbon font-mono truncate max-w-[200px]">
                {session.cwd || 'N/A'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-carbon/[0.06] flex items-center justify-center">
              <Activity className="w-4 h-4 opacity-40" />
            </div>
            <div>
              <p className="text-xs opacity-40">Events</p>
              <p className="text-sm font-medium text-carbon">
                {eventsData?.total ?? session.event_count}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-amber-500/[0.12] flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <p className="text-xs opacity-40">Alerts</p>
              <p className="text-sm font-medium text-carbon">
                {alertsData?.total ?? session.alert_count}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-carbon/[0.06]">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2',
                activeTab === tab.id
                  ? 'text-carbon border-carbon'
                  : 'opacity-50 border-transparent hover:opacity-100 hover:text-alert-red'
              )}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="text-xs font-mono text-severity-critical/70">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'timeline' && (
        <div className="space-y-6">
          {/* Top row: Session Activity chart + Activity Graph side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Session Activity Chart */}
            <div className="lg:col-span-2 card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-medium text-carbon text-sm">Session Activity</h3>
                  {sessionTimeline && (
                    <p className="text-xs font-mono opacity-40 mt-0.5">
                      {sessionTimeline.total_events} events · {sessionTimeline.total_alerts} alerts
                    </p>
                  )}
                </div>
                <span className="text-xs font-mono opacity-30">
                  {sessionTimelineParams.interval}
                </span>
              </div>
              <EventsOverTime
                data={sessionTimeline}
                isLoading={timelineLoading}
                interval={sessionTimelineParams.interval}
              />
            </div>

            {/* Activity Graph Preview */}
            <div className="card flex flex-col">
              <div className="p-4 border-b border-carbon/10 flex items-center justify-between">
                <h3 className="font-medium text-carbon text-sm">Activity Graph</h3>
                <button
                  onClick={() => setActiveTab('graph')}
                  className="text-sm opacity-60 hover:opacity-100 hover:text-alert-red flex items-center gap-1"
                >
                  <Maximize2 className="w-3 h-3" />
                  Expand
                </button>
              </div>
              <div className="flex-1 min-h-[260px]">
                <SessionGraph sessionId={session.session_id} compact />
              </div>
            </div>
          </div>

          {/* Alert Feed */}
          {alerts.length > 0 && (
            <div className="card">
              <div className="px-4 py-3 border-b border-carbon/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-severity-critical" />
                  <h3 className="font-medium text-carbon text-sm">Alerts</h3>
                  <span className="text-xs font-mono bg-severity-critical/10 text-severity-critical px-1.5 py-0.5 font-bold rounded-full">
                    {alerts.length}
                  </span>
                </div>
                <button
                  onClick={() => setActiveTab('alerts')}
                  className="text-xs font-mono opacity-40 hover:opacity-100 hover:text-alert-red"
                >
                  View all
                </button>
              </div>
              <div className="divide-y max-h-48 overflow-y-auto">
                {alerts.slice(0, 5).map((alert) => (
                  <div key={alert.id} onClick={() => setActiveTab('alerts')} className="px-4 py-2.5 flex items-center gap-3 hover:bg-carbon/[0.02] cursor-pointer">
                    <span className={cn(
                      'w-2 h-2 rounded-full flex-shrink-0',
                      alert.severity === 'critical' ? 'bg-severity-critical' :
                      alert.severity === 'high' ? 'bg-severity-high' :
                      alert.severity === 'medium' ? 'bg-severity-medium' : 'bg-severity-low'
                    )} />
                    <span className="text-sm flex-1 min-w-0 truncate">{alert.title}</span>
                    {alert.blocked && (
                      <span className="text-[9px] font-bold rounded-full bg-severity-critical/[0.12] text-severity-critical px-1.5 py-0.5 flex-shrink-0">BLOCKED</span>
                    )}
                    <span className="text-[10px] font-mono opacity-30 flex-shrink-0">
                      {new Date(alert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Event Log — full width below */}
          <div className="card">
            <div className="p-4 border-b border-carbon/10 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-carbon">Event Log</h3>
                {eventsFetching && <Loader2 className="w-4 h-4 opacity-40 animate-spin" />}
              </div>
              {/* Filters */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-40" />
                  <input
                    type="text"
                    placeholder="Search tools, files, commands..."
                    className="input-search pl-8 py-1.5 text-sm w-full"
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                  />
                  {logSearch && (
                    <button
                      onClick={() => setLogSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <select
                  className="input py-1.5 text-sm"
                  value={categoryFilter}
                  onChange={(e) => { setCategoryFilter(e.target.value as EventCategory | ''); setEventsPage(1); }}
                >
                  <option value="">All Categories</option>
                  {Object.values(EventCategory).map((cat) => (
                    <option key={cat} value={cat}>
                      {cat.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                    </option>
                  ))}
                </select>
                <select
                  className="input py-1.5 text-sm"
                  value={severityFilter}
                  onChange={(e) => { setSeverityFilter(e.target.value as Severity | ''); setEventsPage(1); }}
                >
                  <option value="">All Severities</option>
                  {Object.values(Severity).map((sev) => (
                    <option key={sev} value={sev}>
                      {sev.charAt(0).toUpperCase() + sev.slice(1)}
                    </option>
                  ))}
                </select>
                {(categoryFilter || severityFilter || logSearch) && (
                  <button
                    onClick={() => { setCategoryFilter(''); setSeverityFilter(''); setLogSearch(''); setEventsPage(1); }}
                    className="text-xs opacity-50 hover:opacity-100 hover:text-alert-red flex items-center gap-1"
                  >
                    <X className="w-3 h-3" />
                    Clear
                  </button>
                )}
                <span className="text-xs opacity-40 ml-auto">
                  {aggregatedLogEvents.length} groups · {filteredLogEvents.length}{logSearch ? ` / ${events.length}` : ''} events{eventsData && eventsData.total > events.length ? ` (${eventsData.total} total)` : ''}
                </span>
              </div>
            </div>
            {/* Column headers */}
            <div className="grid grid-cols-10 gap-4 px-4 py-2 border-b border-carbon/10 text-[11px] font-mono uppercase tracking-wider font-bold opacity-50 bg-carbon/[0.03]">
              <div className="col-span-2">Time</div>
              <div className="col-span-2">Category</div>
              <div className="col-span-1">Count</div>
              <div className="col-span-4">Target</div>
              <div className="col-span-1"></div>
            </div>
            {eventsLoading ? (
              <div className="divide-y divide-carbon/[0.06]">
                {[...Array(5)].map((_, i) => (
                  <EventCardSkeleton key={i} />
                ))}
              </div>
            ) : aggregatedLogEvents.length === 0 ? (
              <div className="p-12 text-center">
                <Activity className="w-12 h-12 opacity-20 mx-auto mb-3" />
                <p className="opacity-50">
                  {(categoryFilter || severityFilter || logSearch) ? 'No events match your filters' : 'No events recorded for this session'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-carbon/[0.06]">
                {aggregatedLogEvents.map((group) => (
                  <AggregatedEventCard key={group.key} group={group} />
                ))}
              </div>
            )}
            {/* Pagination */}
            {eventsData && eventsData.total > 50 && (
              <div className="flex items-center justify-between p-4 border-t">
                <p className="text-sm opacity-50">
                  Page {eventsPage} of {eventsData.pages}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-full bg-carbon/[0.06] hover:bg-carbon/[0.12] px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    disabled={eventsPage === 1}
                    onClick={() => setEventsPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="rounded-full bg-carbon/[0.06] hover:bg-carbon/[0.12] px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    disabled={eventsPage >= eventsData.pages}
                    onClick={() => setEventsPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'events' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-4">
            <select
              className="input w-48"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as EventCategory | '')}
            >
              <option value="">All Categories</option>
              {Object.values(EventCategory).map((cat) => (
                <option key={cat} value={cat}>
                  {cat.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                </option>
              ))}
            </select>
            <select
              className="input w-48"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as Severity | '')}
            >
              <option value="">All Severities</option>
              {Object.values(Severity).map((sev) => (
                <option key={sev} value={sev}>
                  {sev.charAt(0).toUpperCase() + sev.slice(1)}
                </option>
              ))}
            </select>
            {(categoryFilter || severityFilter) && (
              <button
                onClick={clearFilters}
                className="text-sm opacity-50 hover:opacity-100 hover:text-alert-red flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                Clear
              </button>
            )}
            {eventsFetching && <Loader2 className="w-4 h-4 opacity-40 animate-spin" />}
          </div>

          <div className="card">
            <div className="grid grid-cols-10 gap-4 px-4 py-3 border-b border-carbon/10 text-[11px] font-mono uppercase tracking-wider font-bold opacity-50 bg-carbon/[0.03]">
              <div className="col-span-2">Time</div>
              <div className="col-span-2">Category</div>
              <div className="col-span-1">Severity</div>
              <div className="col-span-4">Details</div>
              <div className="col-span-1"></div>
            </div>
            {eventsLoading ? (
              <div className="divide-y divide-carbon/[0.06]">
                {[...Array(5)].map((_, i) => (
                  <EventCardSkeleton key={i} />
                ))}
              </div>
            ) : events.length === 0 ? (
              <div className="p-12 text-center">
                <Activity className="w-12 h-12 opacity-20 mx-auto mb-3" />
                <p className="opacity-50">No events match your filters</p>
              </div>
            ) : (
              <div className="divide-y divide-carbon/[0.06]">
                {events.map((event) => (
                  <EventCard key={event.id} event={event} showSession={false} />
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {eventsData && eventsData.total > 50 && (
            <div className="flex items-center justify-between">
              <p className="text-sm opacity-50">
                Page {eventsPage} of {Math.ceil(eventsData.total / 50)}
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-full bg-carbon/[0.06] hover:bg-carbon/[0.12] px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  disabled={eventsPage === 1}
                  onClick={() => setEventsPage((p) => p - 1)}
                >
                  Previous
                </button>
                <button
                  className="rounded-full bg-carbon/[0.06] hover:bg-carbon/[0.12] px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  disabled={eventsPage >= eventsData.pages}
                  onClick={() => setEventsPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'alerts' && (
        <div className="card">
          <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-carbon/10 text-[11px] font-mono uppercase tracking-wider font-bold opacity-50 bg-carbon/[0.03]">
            <div className="col-span-1">Severity</div>
            <div className="col-span-4">Alert</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Time</div>
            <div className="col-span-2">Policy</div>
            <div className="col-span-1"></div>
          </div>
          {alertsLoading ? (
            <div className="divide-y divide-carbon/[0.06]">
              {[...Array(3)].map((_, i) => (
                <AlertCardSkeleton key={i} />
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <div className="p-12 text-center">
              <AlertTriangle className="w-12 h-12 opacity-20 mx-auto mb-3" />
              <p className="opacity-50">No alerts for this session</p>
            </div>
          ) : (
            <div className="divide-y divide-carbon/[0.06]">
              {alerts.map((alert) => (
                <AlertCard key={alert.id} alert={alert} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'files' && (
        <div className="card">
          <div className="p-4 border-b border-carbon/10 flex items-center justify-between">
            <h3 className="font-medium text-carbon">File Operations</h3>
            <span className="text-xs opacity-40 font-mono">
              {aggregatedFileEvents.length} groups · {fileEvents.length} events
            </span>
          </div>
          <div className="grid grid-cols-10 gap-4 px-4 py-2 border-b border-carbon/10 text-[11px] font-mono uppercase tracking-wider font-bold opacity-50 bg-carbon/[0.03]">
            <div className="col-span-2">Time</div>
            <div className="col-span-2">Operation</div>
            <div className="col-span-1">Count</div>
            <div className="col-span-4">Path</div>
            <div className="col-span-1"></div>
          </div>
          {eventsLoading ? (
            <div className="divide-y divide-carbon/[0.06]">
              {[...Array(5)].map((_, i) => (
                <EventCardSkeleton key={i} />
              ))}
            </div>
          ) : aggregatedFileEvents.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-12 h-12 opacity-20 mx-auto mb-3" />
              <p className="opacity-50">No file operations recorded</p>
            </div>
          ) : (
            <div className="divide-y divide-carbon/[0.06]">
              {aggregatedFileEvents.map((group) => (
                <AggregatedEventCard key={group.key} group={group} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'commands' && (
        <div className="card">
          <div className="p-4 border-b border-carbon/10 flex items-center justify-between">
            <h3 className="font-medium text-carbon">Shell Commands & Processes</h3>
            <span className="text-xs opacity-40 font-mono">
              {aggregatedCommandEvents.length} groups · {commandEvents.length} events
            </span>
          </div>
          <div className="grid grid-cols-10 gap-4 px-4 py-2 border-b border-carbon/10 text-[11px] font-mono uppercase tracking-wider font-bold opacity-50 bg-carbon/[0.03]">
            <div className="col-span-2">Time</div>
            <div className="col-span-2">Category</div>
            <div className="col-span-1">Count</div>
            <div className="col-span-4">Command</div>
            <div className="col-span-1"></div>
          </div>
          {eventsLoading ? (
            <div className="divide-y divide-carbon/[0.06]">
              {[...Array(5)].map((_, i) => (
                <EventCardSkeleton key={i} />
              ))}
            </div>
          ) : aggregatedCommandEvents.length === 0 ? (
            <div className="p-12 text-center">
              <Terminal className="w-12 h-12 opacity-20 mx-auto mb-3" />
              <p className="opacity-50">No commands executed</p>
            </div>
          ) : (
            <div className="divide-y divide-carbon/[0.06]">
              {aggregatedCommandEvents.map((group) => (
                <AggregatedEventCard key={group.key} group={group} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'network' && (
        <div className="card">
          <div className="p-4 border-b border-carbon/10 flex items-center justify-between">
            <h3 className="font-medium text-carbon">Network Requests</h3>
            <span className="text-xs opacity-40 font-mono">
              {aggregatedNetworkEvents.length} groups · {networkEvents.length} events
            </span>
          </div>
          <div className="grid grid-cols-10 gap-4 px-4 py-2 border-b border-carbon/10 text-[11px] font-mono uppercase tracking-wider font-bold opacity-50 bg-carbon/[0.03]">
            <div className="col-span-2">Time</div>
            <div className="col-span-2">Category</div>
            <div className="col-span-1">Count</div>
            <div className="col-span-4">URL / Domain</div>
            <div className="col-span-1"></div>
          </div>
          {eventsLoading ? (
            <div className="divide-y divide-carbon/[0.06]">
              {[...Array(5)].map((_, i) => (
                <EventCardSkeleton key={i} />
              ))}
            </div>
          ) : aggregatedNetworkEvents.length === 0 ? (
            <div className="p-12 text-center">
              <Globe className="w-12 h-12 opacity-20 mx-auto mb-3" />
              <p className="opacity-50">No network requests recorded</p>
            </div>
          ) : (
            <div className="divide-y divide-carbon/[0.06]">
              {aggregatedNetworkEvents.map((group) => (
                <AggregatedEventCard key={group.key} group={group} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'graph' && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-carbon/10 flex items-center justify-between">
            <div>
              <h3 className="font-medium text-carbon">Session Activity Graph</h3>
              <p className="text-sm opacity-50 mt-1">
                Visual representation of session activity and relationships
              </p>
            </div>
            <Link
              to={`/graph?session=${id}`}
              className="btn btn-secondary text-sm flex items-center gap-1"
            >
              <Maximize2 className="w-3 h-3" />
              Full View
            </Link>
          </div>
          <div className="h-[600px]">
            <SessionGraph sessionId={session.session_id} />
          </div>
        </div>
      )}
    </div>
  );
}
