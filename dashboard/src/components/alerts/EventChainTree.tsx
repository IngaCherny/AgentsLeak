import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Zap, Link2, List } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAlertContext } from '@/api/queries';
import type { AlertContextEvent, Event } from '@/api/types';
import { pairEvents } from '@/components/events/pairEvents';
import { PairedEventCard } from '@/components/events/PairedEventCard';

function formatTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const catColors: Record<string, string> = {
  command_exec: 'bg-risk-critical',
  file_read: 'bg-carbon',
  file_write: 'bg-[#555555]',
  file_delete: 'bg-severity-critical',
  network_access: 'bg-risk-medium',
  code_execution: 'bg-[#b0b0b0]',
};

function EventNode({ event, isLast }: { event: AlertContextEvent; isLast: boolean }) {
  const dotColor = event.is_trigger ? 'bg-severity-critical' : (catColors[event.category] || 'bg-carbon/30');

  return (
    <div className="flex gap-3 relative">
      {/* Vertical line */}
      {!isLast && (
        <div className="absolute left-[7px] top-[18px] bottom-0 w-px bg-carbon/10" />
      )}

      {/* Dot */}
      <div className="flex-shrink-0 mt-1.5 relative z-10">
        <div className={cn(
          'w-[15px] h-[15px] border-2 border-white',
          dotColor,
          event.is_trigger && 'ring-2 ring-severity-critical/30'
        )} />
      </div>

      {/* Content */}
      <div className={cn(
        'flex-1 pb-3 min-w-0',
        event.is_trigger && 'bg-severity-critical/[0.04] border-l-2 border-severity-critical px-3 py-2 -ml-1'
      )}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono opacity-40">{formatTime(event.timestamp)}</span>
          <code className="text-[11px] font-mono font-bold text-carbon/70">{event.tool_name}</code>
          {event.is_trigger && (
            <span className="text-[10px] font-bold font-mono bg-severity-critical text-white px-1.5 py-0.5 uppercase tracking-wider">
              Triggered
            </span>
          )}
        </div>
        {event.description && (
          <p className="text-xs font-mono opacity-40 truncate mt-0.5">{event.description}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Widen an AlertContextEvent into the full Event shape that pairEvents()
 * expects. The context endpoint now returns all the fields we need (hook_type,
 * tool_use_id, blocked, file_paths, commands, urls, tool_input, tool_result),
 * but older alerts may have rows that predate the schema and arrive with these
 * fields absent — default them defensively.
 */
function toEvent(e: AlertContextEvent): Event {
  return {
    id: e.id,
    session_id: e.session_id,
    timestamp: e.timestamp,
    hook_type: e.hook_type ?? 'unknown',
    tool_name: e.tool_name,
    tool_use_id: e.tool_use_id ?? null,
    blocked: e.blocked ?? false,
    category: e.category,
    severity: e.severity,
    file_paths: e.file_paths ?? [],
    commands: e.commands ?? [],
    urls: e.urls ?? [],
    tool_input: e.tool_input ?? null,
    tool_result: e.tool_result ?? null,
  };
}

type ViewMode = 'paired' | 'raw';

interface EventChainTreeProps {
  alertId: string;
  autoExpand?: boolean;
}

export function EventChainTree({ alertId, autoExpand = false }: EventChainTreeProps) {
  const [expanded, setExpanded] = useState(autoExpand);
  const [viewMode, setViewMode] = useState<ViewMode>('paired');
  const { data, isLoading, isError } = useAlertContext(alertId, expanded);

  const events = useMemo(() => data?.events ?? [], [data]);

  const paired = useMemo(() => pairEvents(events.map(toEvent)), [events]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium opacity-60 hover:opacity-100 hover:text-alert-red transition-all"
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <Zap className="w-3.5 h-3.5" />
          Event Chain
          {events.length > 0 && (
            <span className="text-[10px] font-mono opacity-50">({events.length} events)</span>
          )}
        </button>

        {expanded && events.length > 0 && (
          <button
            onClick={() => setViewMode(viewMode === 'paired' ? 'raw' : 'paired')}
            className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider opacity-50 hover:opacity-100 hover:text-alert-red transition-colors"
            title={
              viewMode === 'paired'
                ? 'Showing one card per tool call (Pre+Post paired). Click for flat timeline.'
                : 'Showing every event as its own node. Click to pair Pre+Post into one card per tool call.'
            }
          >
            {viewMode === 'paired' ? (
              <>
                <Link2 className="w-3 h-3" /> Paired
              </>
            ) : (
              <>
                <List className="w-3 h-3" /> Raw
              </>
            )}
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 ml-1 animate-fade-in">
          {isLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="w-4 h-4 animate-spin opacity-40" />
              <span className="text-xs font-mono opacity-40">Loading event chain...</span>
            </div>
          ) : isError ? (
            <p className="text-xs font-mono text-severity-critical opacity-60 py-2">
              Failed to load event chain
            </p>
          ) : events.length === 0 ? (
            <p className="text-xs font-mono opacity-40 py-2">No events found in chain</p>
          ) : viewMode === 'paired' ? (
            <div className="-ml-1">
              {paired.map((pair) => (
                <PairedEventCard
                  key={pair.key}
                  pair={pair}
                  showSession={false}
                />
              ))}
            </div>
          ) : (
            <div>
              {events.map((event, i) => (
                <EventNode
                  key={event.id}
                  event={event}
                  isLast={i === events.length - 1}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
