import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAlertContext } from '@/api/queries';
import type { AlertContextEvent } from '@/api/types';

function formatTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const catColors: Record<string, string> = {
  command_exec: 'bg-[#D90429]',
  file_read: 'bg-[#1A1A1A]',
  file_write: 'bg-[#555555]',
  file_delete: 'bg-severity-critical',
  network_access: 'bg-[#888888]',
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
            <span className="text-[9px] font-bold font-mono bg-severity-critical text-white px-1.5 py-0.5 uppercase tracking-wider">
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

interface EventChainTreeProps {
  alertId: string;
  autoExpand?: boolean;
}

export function EventChainTree({ alertId, autoExpand = false }: EventChainTreeProps) {
  const [expanded, setExpanded] = useState(autoExpand);
  const { data, isLoading, isError } = useAlertContext(alertId, expanded);

  const events = data?.events || [];

  return (
    <div>
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
