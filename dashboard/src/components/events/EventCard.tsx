import { useState, useCallback } from 'react';
import {
  FileText,
  FileEdit,
  Trash2,
  Terminal,
  Globe,
  Code,
  Wrench,
  ChevronDown,
  GitBranch,
  Layers,
  HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SeverityBadge } from '@/components/common/SeverityBadge';
import { ExpandableText } from '@/components/common/ExpandableText';
import { Timestamp } from '@/components/common/TimeAgo';
import { Severity } from '@/api/types';
import type { Event, LiveEvent } from '@/api/types';

interface EventCardProps {
  event: Event | LiveEvent;
  compact?: boolean;
  showSession?: boolean;
  endpointLabel?: string;
  onClick?: () => void;
}

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

const categoryLabels: Record<string, string> = {
  file_read: 'File Read',
  file_write: 'File Write',
  file_delete: 'File Delete',
  command_exec: 'Command',
  network_access: 'Network',
  code_execution: 'Code Exec',
  subagent_spawn: 'Subagent',
  mcp_tool_use: 'MCP Tool',
  session_lifecycle: 'Session',
  unknown: 'Unknown',
};

function getEventSummary(event: Event | LiveEvent): { text: string; prefix?: string } {
  if (event.file_paths && event.file_paths.length > 0) {
    return { text: event.file_paths[0] };
  }
  if (event.commands && event.commands.length > 0) {
    return { text: event.commands[0], prefix: '$ ' };
  }
  if (event.urls && event.urls.length > 0) {
    return { text: event.urls[0] };
  }
  return { text: event.tool_name || event.hook_type || 'Unknown' };
}

/** Shorten a path to `...filename` when the path is long. */
function shortenPath(fullPath: string, maxLen = 50): string {
  if (fullPath.length <= maxLen) return fullPath;
  const parts = fullPath.split('/');
  const filename = parts[parts.length - 1] || parts[parts.length - 2] || fullPath;
  return `...${filename}`;
}

/** Inline path component: shows `...filename` by default, full path on click. */
function SmartPath({ text, prefix }: { text: string; prefix?: string }) {
  const [expanded, setExpanded] = useState(false);
  const short = shortenPath(text);
  const isLong = short !== text;

  const toggle = useCallback((e: React.MouseEvent) => {
    if (isLong) {
      e.stopPropagation();
      setExpanded((v) => !v);
    }
  }, [isLong]);

  return (
    <p
      className={cn(
        'text-sm font-mono',
        expanded ? 'break-all whitespace-normal' : 'truncate',
        isLong && 'cursor-pointer hover:text-alert-red',
      )}
      title={text}
      onClick={toggle}
    >
      {prefix}{expanded ? text : short}
    </p>
  );
}

export function EventCard({ event, compact = false, showSession = true, endpointLabel, onClick }: EventCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const Icon = categoryIcons[event.category] || Code;
  const isNew = 'isNew' in event && event.isNew;

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      setIsExpanded(!isExpanded);
    }
  };

  if (compact) {
    const summary = getEventSummary(event);
    return (
      <div
        className={cn(
          'flex items-center gap-3 px-3 py-2 transition-colors cursor-pointer',
          isNew ? 'bg-paper-dark animate-fade-in' : 'hover:bg-paper-dark',
        )}
        onClick={handleClick}
      >
        <div className="p-1.5 rounded-lg bg-carbon/[0.06]">
          <Icon className="w-3.5 h-3.5 opacity-50" />
        </div>
        <div className="flex-1 min-w-0">
          <ExpandableText
            text={summary.text}
            prefix={summary.prefix}
            maxChars={60}
            className="text-sm text-carbon"
          />
        </div>
        <Timestamp date={event.timestamp} className="text-xs" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'transition-colors',
        isNew && 'bg-paper-dark animate-fade-in',
        isExpanded && 'bg-carbon/[0.02]'
      )}
    >
      <div
        className={cn(
          'grid gap-3 px-4 py-3 items-center cursor-pointer hover:bg-paper-dark transition-colors',
          showSession ? 'grid-cols-12' : 'grid-cols-10'
        )}
        onClick={handleClick}
      >
        {/* Timestamp */}
        <div className={showSession ? 'col-span-1' : 'col-span-2'}>
          <Timestamp date={event.timestamp} />
        </div>

        {/* Endpoint */}
        {showSession && (
          <div className="col-span-2 truncate">
            {endpointLabel ? (
              <span className="text-xs font-mono opacity-50">{endpointLabel}</span>
            ) : (
              <span className="text-xs opacity-30">—</span>
            )}
          </div>
        )}

        {/* Session */}
        {showSession && (
          <div className="col-span-1 truncate">
            <span className="text-xs font-mono opacity-50">{event.session_id.slice(0, 8)}</span>
          </div>
        )}

        {/* Category */}
        <div className="col-span-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-carbon/[0.06]">
              <Icon className="w-3.5 h-3.5 opacity-50" />
            </div>
            <span className="text-sm opacity-60">
              {categoryLabels[event.category] || event.category}
            </span>
          </div>
        </div>

        {/* Severity */}
        <div className="col-span-1">
          <SeverityBadge severity={event.severity as Severity} size="sm" />
        </div>

        {/* Details */}
        <div className={cn('opacity-60 text-sm min-w-0 overflow-hidden', showSession ? 'col-span-4' : 'col-span-4')}>
          <SmartPath text={getEventSummary(event).text} prefix={getEventSummary(event).prefix} />
        </div>

        {/* Expand Icon */}
        <div className="col-span-1 flex justify-end">
          <ChevronDown
            className={cn(
              'w-4 h-4 opacity-40 transition-transform',
              isExpanded && 'rotate-180'
            )}
          />
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-4 pb-4 animate-fade-in">
          <div className="bg-carbon/[0.02] border p-4 space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="opacity-40 mb-1">Event ID</p>
                <p className="opacity-60 font-mono text-xs">{event.id}</p>
              </div>
              <div>
                <p className="opacity-40 mb-1">Session ID</p>
                <p className="opacity-60 font-mono text-xs">{event.session_id}</p>
              </div>
              <div>
                <p className="opacity-40 mb-1">Timestamp</p>
                <p className="opacity-60 text-xs">
                  {new Date(event.timestamp).toLocaleString()}
                </p>
              </div>
            </div>

            <div>
              <p className="opacity-40 mb-1 text-sm">Tool</p>
              <p className="text-carbon">{event.tool_name || 'N/A'}</p>
            </div>

            {event.file_paths && event.file_paths.length > 0 && (
              <div>
                <p className="opacity-40 mb-1 text-sm">File Paths</p>
                {event.file_paths.map((fp, i) => (
                  <p key={i} className="text-carbon font-mono text-sm break-all">{fp}</p>
                ))}
              </div>
            )}

            {event.commands && event.commands.length > 0 && (
              <div>
                <p className="opacity-40 mb-1 text-sm">Commands</p>
                {event.commands.map((cmd, i) => (
                  <pre key={i} className="text-paper-dark font-mono text-xs bg-carbon p-3 overflow-x-auto">
                    $ {cmd}
                  </pre>
                ))}
              </div>
            )}

            {event.urls && event.urls.length > 0 && (
              <div>
                <p className="opacity-40 mb-1 text-sm">URLs</p>
                {event.urls.map((url, i) => (
                  <p key={i} className="text-carbon font-mono text-sm break-all">{url}</p>
                ))}
              </div>
            )}

            {event.tool_input && Object.keys(event.tool_input).length > 0 && (
              <div>
                <p className="opacity-40 mb-1 text-sm">Tool Input</p>
                <pre className="text-paper-dark font-mono text-xs bg-carbon p-3 overflow-x-auto">
                  {JSON.stringify(event.tool_input, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="grid grid-cols-12 gap-4 px-4 py-3 items-center animate-pulse">
      <div className="col-span-2">
        <div className="h-4 bg-carbon/10 w-20 rounded" />
      </div>
      <div className="col-span-2">
        <div className="h-4 bg-carbon/10 w-16 rounded" />
      </div>
      <div className="col-span-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-carbon/10" />
          <div className="h-4 bg-carbon/10 w-20 rounded" />
        </div>
      </div>
      <div className="col-span-1">
        <div className="h-5 bg-carbon/10 w-14 rounded-full" />
      </div>
      <div className="col-span-4">
        <div className="h-4 bg-carbon/10 w-full rounded" />
      </div>
      <div className="col-span-1" />
    </div>
  );
}

import type { AggregatedEvent } from './aggregateEvents';

function formatTimeRange(first: string, last: string): string {
  const f = new Date(first);
  const l = new Date(last);
  const diffMs = l.getTime() - f.getTime();
  if (diffMs < 1000) return '';
  if (diffMs < 60_000) return `${Math.round(diffMs / 1000)}s span`;
  if (diffMs < 3600_000) return `${Math.round(diffMs / 60_000)}m span`;
  return `${(diffMs / 3600_000).toFixed(1)}h span`;
}

export function AggregatedEventCard({ group }: { group: AggregatedEvent }) {
  const Icon = categoryIcons[group.category] || Code;
  const isSingle = group.count === 1;

  if (isSingle) {
    return <EventCard event={group.representative} showSession={false} />;
  }

  const timeRange = formatTimeRange(group.firstTime, group.lastTime);

  return (
    <div>
      <div className="grid grid-cols-10 gap-4 px-4 py-3 items-center">
        {/* Timestamp */}
        <div className="col-span-2">
          <Timestamp date={group.lastTime} />
          {timeRange && (
            <span className="text-[10px] font-mono opacity-30 ml-1">({timeRange})</span>
          )}
        </div>

        {/* Category */}
        <div className="col-span-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-carbon/[0.06]">
              <Icon className="w-3.5 h-3.5 opacity-50" />
            </div>
            <span className="text-sm opacity-60">
              {categoryLabels[group.category] || group.category}
            </span>
          </div>
        </div>

        {/* Severity */}
        <div className="col-span-1">
          <SeverityBadge severity={group.representative.severity as Severity} size="sm" />
        </div>

        {/* Target */}
        <div className="col-span-4 opacity-60 text-sm min-w-0 overflow-hidden">
          <SmartPath text={group.target} prefix={group.prefix} />
        </div>

        {/* Count badge */}
        <div className="col-span-1 flex justify-end">
          <span className="inline-flex items-center px-2 py-0.5 text-xs font-mono font-bold bg-carbon/[0.06] rounded-full">
            x{group.count}
          </span>
        </div>
      </div>
    </div>
  );
}

export default EventCard;
