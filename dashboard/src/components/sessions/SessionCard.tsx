import { Link } from 'react-router-dom';
import {
  Layers,
  Clock,
  Activity,
  AlertTriangle,
  ChevronRight,
  Gauge,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TimeAgo } from '@/components/common/TimeAgo';
import type { Session } from '@/api/types';

interface SessionCardProps {
  session: Session;
  variant?: 'row' | 'card';
  showRiskScore?: boolean;
}

function SourceBadge({ source }: { source?: string | null }) {
  const label = source === 'cursor' ? 'Cursor' : 'Claude Code';
  const styles = source === 'cursor'
    ? 'bg-carbon/[0.08] text-carbon/70 dark:bg-white/[0.08] dark:text-white/60'
    : 'bg-carbon/[0.05] text-carbon/50 dark:bg-white/[0.05] dark:text-white/40';
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono rounded', styles)}>
      {label}
    </span>
  );
}

export { SourceBadge };

const statusStyles: Record<string, { bg: string; text: string; border: string; label: string }> = {
  active: {
    bg: 'bg-green-50',
    text: 'text-green-600',
    border: 'border-green-200',
    label: 'Active',
  },
  ended: {
    bg: 'bg-carbon/[0.04]',
    text: 'opacity-50',
    border: 'border',
    label: 'Ended',
  },
};

function getRiskLevel(riskScore: number): { color: string; label: string; value: number } {
  if (riskScore <= 10) return { color: 'text-green-500', label: 'Low', value: riskScore };
  if (riskScore <= 50) return { color: 'text-yellow-500', label: 'Medium', value: riskScore };
  if (riskScore <= 150) return { color: 'text-orange-500', label: 'High', value: riskScore };
  return { color: 'text-severity-critical', label: 'Critical', value: riskScore };
}

function formatDuration(startTime: string, endTime?: string | null): string {
  const start = new Date(startTime).getTime();
  const end = endTime ? new Date(endTime).getTime() : Date.now();
  const durationMs = end - start;

  const hours = Math.floor(durationMs / (1000 * 60 * 60));
  const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function SessionCard({ session, variant = 'row', showRiskScore = true }: SessionCardProps) {
  const status = statusStyles[session.status] || statusStyles.ended;
  const risk = getRiskLevel(session.risk_score ?? 0);
  const displayName = session.cwd?.split('/').pop() || session.session_id.slice(0, 12);

  if (variant === 'card') {
    return (
      <Link
        to={`/sessions/${session.session_id}`}
        className="card p-4 block"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-carbon/[0.08] flex items-center justify-center">
              <Layers className="w-4 h-4 text-carbon/60" />
            </div>
            <div>
              <p className="text-sm font-medium text-carbon">{displayName}</p>
              <p className="text-[10px] opacity-40 font-mono">{session.session_id.slice(0, 12)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SourceBadge source={session.session_source} />
            <span
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full',
                status.bg,
                status.text,
                status.border
              )}
            >
              {session.status === 'active' && (
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              )}
              {status.label}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 opacity-40" />
            <span className="opacity-60">{session.event_count} events</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 opacity-40" />
            <span className="opacity-60">{session.alert_count} alerts</span>
          </div>
          {showRiskScore && (
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 opacity-40" />
              <span className={risk.color}>{risk.label}</span>
              {risk.value > 0 && (
                <span className="text-[10px] font-mono opacity-30">{risk.value}</span>
              )}
            </div>
          )}
        </div>

        <div className="mt-3 pt-3 border-t flex items-center justify-between">
          <div className="flex items-center gap-2 opacity-40 text-xs">
            <Clock className="w-3.5 h-3.5" />
            {session.status === 'active' ? (
              <span>Started <TimeAgo date={session.started_at} className="opacity-50" /></span>
            ) : (
              <span>Duration: {formatDuration(session.started_at, session.ended_at)}</span>
            )}
          </div>
          <ChevronRight className="w-4 h-4 opacity-40" />
        </div>
      </Link>
    );
  }

  const endpointLabel = session.endpoint_user
    ? `${session.endpoint_user}@${session.endpoint_hostname || '?'}`
    : session.endpoint_hostname || null;

  return (
    <Link
      to={`/sessions/${session.session_id}`}
      className="grid grid-cols-12 gap-3 px-4 py-3.5 items-center hover:bg-paper-dark transition-colors"
    >
      <div className="col-span-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-carbon/[0.08] flex items-center justify-center flex-shrink-0">
            <Layers className="w-4 h-4 text-carbon/60" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-carbon truncate">{displayName}</p>
            <p className="text-[10px] opacity-40 font-mono">{session.session_id.slice(0, 12)}</p>
          </div>
        </div>
      </div>
      <div className="col-span-2 truncate">
        {endpointLabel ? (
          <span className="text-xs font-mono opacity-50">{endpointLabel}</span>
        ) : (
          <span className="text-xs opacity-30">&mdash;</span>
        )}
      </div>
      <div className="col-span-1">
        <SourceBadge source={session.session_source} />
      </div>
      <div className="col-span-1">
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full',
            status.bg,
            status.text,
            status.border
          )}
        >
          {session.status === 'active' && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          )}
          {status.label}
        </span>
      </div>
      <div className="col-span-2 flex items-center gap-1.5 opacity-50 text-xs">
        <Clock className="w-3.5 h-3.5" />
        <TimeAgo date={session.started_at} />
      </div>
      <div className="col-span-1 flex items-center gap-1.5 opacity-60 text-xs">
        <Activity className="w-3.5 h-3.5 opacity-40" />
        {session.event_count}
      </div>
      <div className="col-span-1 flex items-center gap-1.5 opacity-60 text-xs">
        <AlertTriangle className="w-3.5 h-3.5 opacity-40" />
        {session.alert_count}
      </div>
      <div className="col-span-1 text-xs">
        <span className={cn('font-mono font-medium', risk.color)}>{risk.label}</span>
      </div>
      <div className="col-span-1 flex justify-end">
        <ChevronRight className="w-4 h-4 opacity-40" />
      </div>
    </Link>
  );
}

export function SessionCardSkeleton({ variant = 'row' }: { variant?: 'row' | 'card' }) {
  if (variant === 'card') {
    return (
      <div className="card p-4 animate-pulse">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[10px] bg-carbon/10" />
            <div>
              <div className="h-4 bg-carbon/10 w-24 mb-1 rounded" />
              <div className="h-3 bg-carbon/10 w-20 rounded" />
            </div>
          </div>
          <div className="h-6 bg-carbon/10 w-16 rounded-full" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="h-4 bg-carbon/10 rounded" />
          <div className="h-4 bg-carbon/10 rounded" />
          <div className="h-4 bg-carbon/10 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-3 px-4 py-3.5 items-center animate-pulse">
      <div className="col-span-2 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-carbon/10" />
        <div>
          <div className="h-3.5 bg-carbon/10 w-20 mb-1 rounded" />
          <div className="h-2.5 bg-carbon/10 w-16 rounded" />
        </div>
      </div>
      <div className="col-span-2">
        <div className="h-3.5 bg-carbon/10 w-24 rounded" />
      </div>
      <div className="col-span-1">
        <div className="h-4 bg-carbon/10 w-14 rounded" />
      </div>
      <div className="col-span-1">
        <div className="h-5 bg-carbon/10 w-12 rounded-full" />
      </div>
      <div className="col-span-2">
        <div className="h-3.5 bg-carbon/10 w-20 rounded" />
      </div>
      <div className="col-span-1">
        <div className="h-3.5 bg-carbon/10 w-6 rounded" />
      </div>
      <div className="col-span-1">
        <div className="h-3.5 bg-carbon/10 w-6 rounded" />
      </div>
      <div className="col-span-1">
        <div className="h-3.5 bg-carbon/10 w-10 rounded" />
      </div>
      <div className="col-span-1" />
    </div>
  );
}

export default SessionCard;
