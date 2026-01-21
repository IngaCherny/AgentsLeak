import { useState, useMemo } from 'react';
import {
  Layers,
  Search,
  RefreshCw,
  X,
  AlertTriangle,
  Monitor,
  Cpu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSessions, useEndpointStats } from '@/api/queries';
import { SessionCard, SessionCardSkeleton } from '@/components/sessions/SessionCard';
import { SessionStatus } from '@/api/types';

type StatusFilter = string | 'all';

export default function Sessions() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [endpointFilter, setEndpointFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

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

  const filters = {
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(endpointFilter !== 'all' ? { endpoint: endpointFilter } : {}),
    ...(sourceFilter !== 'all' ? { session_source: sourceFilter } : {}),
  };
  const activeFilters = Object.keys(filters).length > 0 ? filters : undefined;
  const { data, isLoading, isError, error, refetch, isFetching } = useSessions(activeFilters, page, pageSize);

  const sessions = data?.items || [];
  const total = data?.total || 0;
  const hasMore = data ? page < data.pages : false;

  // Filter sessions by search query
  const filteredSessions = searchQuery
    ? sessions.filter(
        (session) =>
          session.session_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (session.cwd || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sessions;

  const startIndex = (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, total);

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
            <input
              type="text"
              placeholder="Search sessions..."
              className="input-search pl-9 w-64"
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

          {/* Status Filter Pills */}
          <div className="flex items-center gap-1 bg-carbon/[0.04] rounded-full p-0.5">
            {[
              { value: 'all' as StatusFilter, label: 'All' },
              { value: SessionStatus.Active, label: 'Active' },
              { value: SessionStatus.Ended, label: 'Ended' },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  setStatusFilter(option.value);
                  setPage(1);
                }}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium rounded-full transition-all',
                  statusFilter === option.value
                    ? 'bg-carbon text-white shadow-sm'
                    : 'text-carbon/50 hover:text-alert-red'
                )}
              >
                {option.label}
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
        </div>

        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="btn btn-secondary flex items-center gap-2"
        >
          <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Error State */}
      {isError && (
        <div className="card p-6">
          <div className="flex items-center gap-3 text-red-400">
            <AlertTriangle className="w-5 h-5" />
            <p>Failed to load sessions: {(error as Error)?.message || 'Unknown error'}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="mt-4 btn btn-secondary text-sm"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Sessions Table */}
      {!isError && (
        <div className="card overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-3 px-4 py-2.5 border-b border-carbon/10 text-[10px] font-mono uppercase tracking-wider font-bold opacity-50 bg-carbon/[0.03]">
            <div className="col-span-2">Session</div>
            <div className="col-span-2">Endpoint</div>
            <div className="col-span-1">Source</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-2">Started</div>
            <div className="col-span-1">Events</div>
            <div className="col-span-1">Alerts</div>
            <div className="col-span-1">Risk</div>
            <div className="col-span-1"></div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-carbon/10">
            {isLoading ? (
              [...Array(5)].map((_, i) => <SessionCardSkeleton key={i} />)
            ) : filteredSessions.length === 0 ? (
              <div className="p-12 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-[10px] bg-carbon/[0.06] mb-4">
                  <Layers className="w-8 h-8 opacity-40" />
                </div>
                <h3 className="text-lg font-medium opacity-60 mb-2">
                  {searchQuery || endpointFilter !== 'all' || statusFilter !== 'all' || sourceFilter !== 'all'
                    ? 'No matching sessions'
                    : 'No sessions found'}
                </h3>
                <p className="opacity-50">
                  {searchQuery || endpointFilter !== 'all' || statusFilter !== 'all' || sourceFilter !== 'all'
                    ? 'Try adjusting your filters or search query.'
                    : 'Sessions will appear here when AI agents connect.'}
                </p>
              </div>
            ) : (
              filteredSessions.map((session) => (
                <SessionCard key={session.id} session={session} />
              ))
            )}
          </div>
        </div>
      )}

      {/* Pagination */}
      {!isLoading && !isError && total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm opacity-50">
            Showing{' '}
            <span className="font-medium text-carbon">
              {startIndex}-{endIndex}
            </span>{' '}
            of <span className="font-medium text-carbon">{total}</span> sessions
          </p>
          <div className="flex items-center gap-2">
            <button
              className="rounded-full bg-carbon/[0.06] hover:bg-carbon/[0.12] px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-30 disabled:pointer-events-none"
              disabled={page === 1 || isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
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
    </div>
  );
}
