import { useState, useCallback, useEffect, useRef } from 'react';
import {
  GitBranch,
  Download,
  RefreshCw,
  Clock,
  Search,
  X,
  Map,
  Maximize2,
  ChevronDown,
  ChevronRight,
  Activity,
  AlertTriangle,
  Layers,
  Monitor,
  Cpu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDarkMode } from '@/lib/useDarkMode';
import { SessionGraph, GlobalGraph, TimeRange } from '@/components/graph';
import { useSessions, useEndpointStats } from '@/api/queries';

type ViewMode = 'session' | 'global';

const timeRangeOptions: { value: TimeRange; label: string }[] = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
];

export default function Graph() {
  const isDark = useDarkMode();
  const [viewMode, setViewMode] = useState<ViewMode>('session');
  const [selectedSession, setSelectedSession] = useState<string>('');
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [endpointFilter, setEndpointFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const { data: endpointStatsData } = useEndpointStats();
  const sessionFilters = (endpointFilter !== 'all' || sourceFilter !== 'all')
    ? { ...(endpointFilter !== 'all' && { endpoint: endpointFilter }), ...(sourceFilter !== 'all' && { session_source: sourceFilter }) }
    : undefined;
  const { data: sessionsData } = useSessions(sessionFilters, 1, 50);

  // Auto-select the most recent session
  useEffect(() => {
    if (sessionsData?.items?.length && !selectedSession) {
      setSelectedSession(sessionsData.items[0].session_id);
    }
  }, [sessionsData, selectedSession]);

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  const handleExport = useCallback(() => {
    const container = graphContainerRef.current;
    if (!container) return;

    // Export the graph SVG element
    const svgEl = container.querySelector('.react-flow__viewport');
    if (svgEl) {
      // Clone the SVG parent and serialize
      const svgRoot = container.querySelector('svg.react-flow__edges');
      if (svgRoot) {
        const clone = svgRoot.cloneNode(true) as SVGElement;
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(clone);
        const blob = new Blob([svgString], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `agentsleak-graph-${new Date().toISOString().slice(0, 19)}.svg`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
    }

    // Fallback: export graph metadata as JSON
    const data = {
      viewMode,
      selectedSession,
      timeRange,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentsleak-graph-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [viewMode, selectedSession, timeRange]);

  const toggleSearch = useCallback(() => {
    setShowSearch((s) => {
      if (s) setSearchQuery('');
      return !s;
    });
  }, []);

  // Get selected session data for stats bar
  const selectedSessionData = sessionsData?.items?.find(
    (s) => s.session_id === selectedSession
  );

  return (
    <div className="h-full flex flex-col space-y-3">
      {/* Header Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 bg-carbon/[0.04] rounded-full p-0.5">
            <button
              onClick={() => setViewMode('session')}
              className={cn(
                'px-4 py-1.5 text-sm font-display font-medium rounded-full transition-all',
                viewMode === 'session'
                  ? 'bg-carbon text-white shadow-sm'
                  : 'text-carbon/50 hover:text-alert-red'
              )}
            >
              Session
            </button>
            <button
              onClick={() => setViewMode('global')}
              className={cn(
                'px-4 py-1.5 text-sm font-display font-medium rounded-full transition-all',
                viewMode === 'global'
                  ? 'bg-carbon text-white shadow-sm'
                  : 'text-carbon/50 hover:text-alert-red'
              )}
            >
              Global
            </button>
          </div>

          {/* Endpoint Filter */}
          <div className="relative">
            <Monitor className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40 pointer-events-none" />
            <select
              className="input-search pl-9 pr-8 w-56 text-sm appearance-none cursor-pointer"
              value={endpointFilter}
              onChange={(e) => {
                setEndpointFilter(e.target.value);
                setSelectedSession('');
              }}
            >
              <option value="all">All Endpoints</option>
              {(endpointStatsData?.items || []).filter((ep) => ep.endpoint_hostname).map((ep) => {
                const label = ep.endpoint_user
                  ? `${ep.endpoint_user}@${ep.endpoint_hostname}`
                  : ep.endpoint_hostname;
                return (
                  <option key={ep.endpoint_hostname!} value={ep.endpoint_hostname!}>
                    {label} ({ep.session_count})
                  </option>
                );
              })}
            </select>
            {endpointFilter !== 'all' && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-40 hover:text-alert-red"
                onClick={() => { setEndpointFilter('all'); setSelectedSession(''); }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Source Filter */}
          <div className="relative">
            <Cpu className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40 pointer-events-none" />
            <select
              className="input-search pl-9 pr-8 w-44 text-sm appearance-none cursor-pointer"
              value={sourceFilter}
              onChange={(e) => {
                setSourceFilter(e.target.value);
                setSelectedSession('');
              }}
            >
              <option value="all">All Sources</option>
              <option value="claude_code">Claude Code</option>
              <option value="cursor">Cursor</option>
            </select>
            {sourceFilter !== 'all' && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-40 hover:text-alert-red"
                onClick={() => { setSourceFilter('all'); setSelectedSession(''); }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Session Selector (session view) */}
          {viewMode === 'session' && (
            <select
              className="input-search min-w-[250px]"
              value={selectedSession}
              onChange={(e) => setSelectedSession(e.target.value)}
            >
              <option value="">Select a session...</option>
              {(sessionsData?.items || []).map((session) => {
                const displayName = session.cwd?.split('/').pop() || 'unknown';
                const statusIcon = session.status === 'active' ? '\u25CF ' : '';
                return (
                  <option key={session.session_id} value={session.session_id}>
                    {statusIcon}{displayName} — {session.session_id.slice(0, 12)} ({session.event_count} events)
                  </option>
                );
              })}
            </select>
          )}

          {/* Time Range Pills (global view) */}
          {viewMode === 'global' && (
            <div className="flex items-center gap-1 bg-carbon/[0.04] rounded-full p-0.5">
              <Clock className="w-3.5 h-3.5 opacity-40 ml-1.5" />
              {timeRangeOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setTimeRange(option.value)}
                  className={cn(
                    'px-3 py-1 text-xs font-mono font-bold rounded-full transition-all',
                    timeRange === option.value
                      ? 'bg-carbon text-white shadow-sm'
                      : 'text-carbon/50 hover:text-alert-red'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          {/* Session Stats Bar */}
          {viewMode === 'session' && selectedSessionData && (
            <div className="flex items-center gap-4 text-xs font-mono opacity-50">
              <div className="flex items-center gap-1.5">
                <Activity className="w-3 h-3" />
                <span>{selectedSessionData.event_count} events</span>
              </div>
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3" />
                <span>{selectedSessionData.alert_count} alerts</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  selectedSessionData.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-carbon/30'
                )} />
                <span>{selectedSessionData.status}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Search */}
          {showSearch && (
            <div className="flex items-center bg-carbon/[0.04] rounded-full">
              <Search className="w-4 h-4 opacity-40 ml-2.5" />
              <input
                type="text"
                placeholder="Search nodes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-2 py-1.5 text-sm font-mono bg-transparent outline-none w-48"
                autoFocus
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="mr-2 opacity-40 hover:text-alert-red">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
          <button
            className={cn('w-8 h-8 rounded-full flex items-center justify-center transition-colors', showSearch ? 'bg-carbon text-white' : 'bg-carbon/[0.04] hover:bg-carbon/[0.08]')}
            onClick={toggleSearch}
            title="Search nodes"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            className={cn('w-8 h-8 rounded-full flex items-center justify-center transition-colors', showMinimap ? 'bg-carbon text-white' : 'bg-carbon/[0.04] hover:bg-carbon/[0.08]')}
            onClick={() => setShowMinimap(!showMinimap)}
            title={showMinimap ? 'Hide minimap' : 'Show minimap'}
          >
            <Map className="w-4 h-4" />
          </button>
          <button
            className="w-8 h-8 rounded-full bg-carbon/[0.04] hover:bg-carbon/[0.08] flex items-center justify-center transition-colors"
            onClick={() => setRefreshKey((k) => k + 1)}
            title="Fit to view"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            className="w-8 h-8 rounded-full bg-carbon/[0.04] hover:bg-carbon/[0.08] flex items-center justify-center transition-colors"
            onClick={handleRefresh}
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            className="rounded-full bg-carbon/[0.04] hover:bg-carbon/[0.08] px-3 py-1.5 flex items-center gap-2 transition-colors"
            onClick={handleExport}
            title="Export graph as PNG"
          >
            <Download className="w-4 h-4" />
            <span className="text-sm font-display font-medium">Export</span>
          </button>
        </div>
      </div>

      {/* Graph Container */}
      <div ref={graphContainerRef} className="flex-1 card overflow-hidden">
        {viewMode === 'session' ? (
          selectedSession ? (
            <SessionGraph
              key={`session-${selectedSession}-${refreshKey}`}
              sessionId={selectedSession}
              showMinimap={showMinimap}
            />
          ) : (
            <div className="h-full flex items-center justify-center bg-carbon/[0.02]">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-[10px] bg-carbon/[0.06] mb-4">
                  <GitBranch className="w-10 h-10 opacity-40" />
                </div>
                <h3 className="text-xl font-display font-medium opacity-60 mb-2">
                  Session Activity Graph
                </h3>
                <p className="opacity-50 max-w-md font-mono text-sm">
                  Select a session to view its activity graph showing file
                  access, process spawns, and network connections.
                </p>
              </div>
            </div>
          )
        ) : (
          <GlobalGraph
            key={`global-${refreshKey}-${endpointFilter}-${sourceFilter}`}
            timeRange={timeRange}
            showMinimap={showMinimap}
            endpoint={endpointFilter !== 'all' ? endpointFilter : undefined}
            source={sourceFilter !== 'all' ? sourceFilter : undefined}
          />
        )}
      </div>

      {/* Risk Legend */}
      <div className="card overflow-hidden">
        <button
          className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-carbon/[0.02] transition-colors"
          onClick={() => setShowLegend(!showLegend)}
        >
          <div className="flex items-center gap-3">
            <Layers className="w-3.5 h-3.5 opacity-40" />
            <span className="text-xs font-display font-medium opacity-50 uppercase tracking-wider">Risk Legend</span>
            {!showLegend && (
              <div className="flex items-center gap-3 ml-2">
                {[
                  { color: 'bg-[#D90429]', label: 'Critical' },
                  { color: 'bg-[#C4516C]', label: 'High' },
                  { color: 'bg-[#1A1A1A]', label: 'Medium' },
                  { color: 'bg-[#C8C8C8]', label: 'Low' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-1">
                    <span className={cn('w-2 h-2 rounded-full', item.color)} />
                    <span className="text-[10px] font-mono opacity-35">{item.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {showLegend
            ? <ChevronDown className="w-3.5 h-3.5 opacity-30" />
            : <ChevronRight className="w-3.5 h-3.5 opacity-30" />
          }
        </button>
        {showLegend && (
          <div className="px-4 pb-4 pt-1 animate-fade-in">
            <p className="text-xs font-mono opacity-40 mb-3">
              Color encodes risk — how much damage a tool or resource can cause if misused by an AI agent.
            </p>
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                {
                  level: 'CRITICAL',
                  color: 'bg-[#D90429]',
                  border: 'border-[#D90429]',
                  tools: 'Bash, Task',
                  desc: 'Can execute arbitrary code',
                },
                {
                  level: 'HIGH',
                  color: 'bg-[#C4516C]',
                  border: 'border-[#C4516C]',
                  tools: 'WebFetch, WebSearch',
                  desc: 'Can exfiltrate data over network',
                },
                {
                  level: 'MEDIUM',
                  color: 'bg-[#1A1A1A]',
                  border: 'border-[#1A1A1A]',
                  tools: 'Write, Edit',
                  desc: 'Can mutate files on disk',
                },
                {
                  level: 'LOW',
                  color: 'bg-[#F4F4F4] border border-[#C8C8C8]',
                  border: 'border-[#C8C8C8]',
                  tools: 'Read, Glob, Grep',
                  desc: 'Read-only, minimal risk',
                },
              ].map((item) => (
                <div key={item.level} className={cn('border-l-[3px] pl-3 py-1.5', item.border)}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={cn('w-2.5 h-2.5 rounded-full', item.color)} />
                    <span className="text-[10px] font-display font-bold tracking-wider opacity-60">{item.level}</span>
                  </div>
                  <p className="text-[11px] font-mono font-medium opacity-70 mb-0.5">{item.tools}</p>
                  <p className="text-[10px] font-mono opacity-40">{item.desc}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-5 pt-2 border-t border-carbon/10">
              <span className="text-[10px] font-display font-medium opacity-30 uppercase tracking-wider">Edges</span>
              {[
                { label: 'READ', color: isDark ? '#666666' : '#C8C8C8', dashed: true },
                { label: 'WRITE', color: isDark ? '#a0a0a0' : '#1A1A1A', dashed: false },
                { label: 'DELETE', color: '#D90429', dashed: false },
                { label: 'EXECUTE', color: isDark ? '#888888' : '#8B8B8B', dashed: false },
                { label: 'CONNECT', color: '#C4516C', dashed: true },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <div
                    className="w-5 h-0.5 rounded-full"
                    style={{
                      backgroundColor: item.dashed ? 'transparent' : item.color,
                      backgroundImage: item.dashed
                        ? `repeating-linear-gradient(90deg, ${item.color} 0, ${item.color} 3px, transparent 3px, transparent 6px)`
                        : undefined,
                    }}
                  />
                  <span className="text-[10px] font-mono opacity-40">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
