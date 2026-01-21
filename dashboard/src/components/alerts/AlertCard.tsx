import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight,
  ExternalLink,
  ShieldAlert,
  Zap,
  Terminal,
  FileText,
  Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TimeAgo } from '@/components/common/TimeAgo';
import { EventChainTree } from '@/components/alerts/EventChainTree';
import { AlertAttackChain } from '@/components/alerts/AlertAttackChain';
import type { Alert, LiveAlert } from '@/api/types';

// ── Helpers ─────────────────────────────────────────────────────────────────

const catIcon = (cat: string) => {
  if (cat.includes('file')) return FileText;
  if (cat.includes('network')) return Globe;
  if (cat.includes('command')) return Terminal;
  return Zap;
};

// ── Props ───────────────────────────────────────────────────────────────────

interface AlertCardProps {
  alert: Alert | LiveAlert;
  onAcknowledge?: (id: string) => void;
  onResolve?: (id: string) => void;
  onMarkFalsePositive?: (id: string) => void;
  compact?: boolean;
  /** Render as grid-cols-12 table row (for LiveFeed alerts table). */
  tableRow?: boolean;
  endpointLabel?: string;
}

// ── Compact variant (for sidebar/dashboard) ─────────────────────────────────

function CompactAlertCard({ alert }: { alert: Alert | LiveAlert }) {
  const isNew = 'isNew' in alert && alert.isNew;

  return (
    <Link
      to={`/alerts?id=${alert.id}`}
      className={cn(
        'block p-3 transition-colors',
        isNew ? 'bg-paper-dark animate-fade-in' : 'hover:bg-paper-dark'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-carbon truncate">{alert.title}</p>
          <p className="text-xs opacity-40 mt-0.5">
            <TimeAgo date={alert.created_at} />
          </p>
        </div>
      </div>
    </Link>
  );
}

// ── Tabbed expand content ───────────────────────────────────────────────────

type ExpandTab = 'details' | 'evidence' | 'chain';

function AlertExpandContent({
  alert,
  onAcknowledge,
  onResolve,
  onMarkFalsePositive,
}: {
  alert: Alert | LiveAlert;
  onAcknowledge?: (id: string) => void;
  onResolve?: (id: string) => void;
  onMarkFalsePositive?: (id: string) => void;
}) {
  const [tab, setTab] = useState<ExpandTab>('details');

  return (
    <div className="px-4 pb-4 pt-2 animate-fade-in">
      {/* Tab bar + action buttons */}
      <div className="flex items-center gap-0.5 mb-3 border-b border-carbon/[0.06]">
        {([
          { key: 'details' as const, label: 'Details' },
          { key: 'evidence' as const, label: 'Evidence' },
          { key: 'chain' as const, label: 'Attack Chain' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={(e) => { e.stopPropagation(); setTab(t.key); }}
            className={cn(
              'px-3 py-1.5 text-xs font-mono uppercase tracking-wider -mb-px border-b-2 transition-colors',
              tab === t.key
                ? 'border-carbon font-bold'
                : 'border-transparent opacity-40 hover:opacity-100'
            )}
          >
            {t.label}
          </button>
        ))}

        <div className="flex-1" />

        <div className="flex gap-1.5 pb-1.5" onClick={(e) => e.stopPropagation()}>
          <Link
            to={`/sessions/${alert.session_id}`}
            className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-carbon/[0.06] opacity-60 hover:opacity-100 hover:bg-carbon/[0.12] flex items-center gap-1 transition-all"
          >
            <ExternalLink className="w-2.5 h-2.5" /> SESSION
          </Link>

          {(alert.status === 'new') && onAcknowledge && (
            <button
              onClick={() => onAcknowledge(alert.id)}
              className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-carbon text-white"
            >
              ACK
            </button>
          )}

          {(alert.status === 'new' || alert.status === 'investigating') && onResolve && (
            <button
              onClick={() => onResolve(alert.id)}
              className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-carbon/[0.06] opacity-60 hover:opacity-100 hover:bg-carbon/[0.12] transition-all"
            >
              RESOLVE
            </button>
          )}

          {(alert.status === 'new' || alert.status === 'investigating') && onMarkFalsePositive && (
            <button
              onClick={() => onMarkFalsePositive(alert.id)}
              className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-carbon/[0.04] opacity-40 hover:opacity-100 hover:bg-carbon/[0.08] transition-all"
            >
              FALSE +
            </button>
          )}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'details' && (
        <div className="space-y-3">
          {alert.description && (
            <p className="text-sm opacity-60">{alert.description}</p>
          )}

          <div className="grid grid-cols-5 gap-3">
            <div>
              <p className="text-[10px] font-mono opacity-40 uppercase mb-0.5">Policy</p>
              <p className="text-xs font-mono">{alert.policy_name || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono opacity-40 uppercase mb-0.5">Session</p>
              <p className="text-xs font-mono">{alert.session_id.slice(0, 12)}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono opacity-40 uppercase mb-0.5">Endpoint</p>
              <p className="text-xs font-mono">
                {alert.endpoint_user
                  ? `${alert.endpoint_user}@${alert.endpoint_hostname || '?'}`
                  : alert.endpoint_hostname || '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono opacity-40 uppercase mb-0.5">Category</p>
              <p className="text-xs">{alert.category}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono opacity-40 uppercase mb-0.5">Time</p>
              <p className="text-xs font-mono">{new Date(alert.created_at).toLocaleString()}</p>
            </div>
          </div>

          {alert.blocked && (
            <div className="flex items-center gap-2 text-severity-critical text-xs font-medium">
              <ShieldAlert className="w-3.5 h-3.5" />
              Action was blocked by policy
            </div>
          )}

          {alert.tags && alert.tags.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {alert.tags.map((t, i) => (
                <span key={i} className="rounded-full bg-carbon/[0.04] px-2 py-0.5 text-[10px] font-mono">{t}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'evidence' && (
        <div>
          {alert.evidence && alert.evidence.length > 0 ? (
            <div className="space-y-3">
              {alert.evidence.map((ev, i) => (
                <div key={i} className="space-y-2">
                  {/* Inline metadata */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {ev.description && (
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[9px] font-mono uppercase tracking-wider text-carbon/40 dark:text-white/30">Event</span>
                        <span className="text-[11px] font-mono font-medium">{ev.description}</span>
                      </div>
                    )}
                    {ev.timestamp && (
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[9px] font-mono uppercase tracking-wider text-carbon/40 dark:text-white/30">Time</span>
                        <span className="text-[11px] font-mono font-medium">{new Date(ev.timestamp).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                  {/* Dangerous content — command / url / file */}
                  {(ev.command || ev.url || ev.file_path) && (
                    <div>
                      <p className="text-[8px] font-mono uppercase tracking-[0.15em] text-carbon/30 dark:text-white/25 mb-1">
                        {ev.command ? 'Matched Command' : ev.url ? 'Matched URL' : 'Matched File'}
                      </p>
                      <div className="bg-alert-red/[0.04] dark:bg-alert-red/[0.08] border-l-[3px] border-alert-red rounded-r-lg px-3 py-2 font-mono text-[11px] text-carbon dark:text-white break-all leading-relaxed">
                        {ev.command || ev.url || ev.file_path}
                      </div>
                    </div>
                  )}
                  {/* Extra data fields */}
                  {ev.data && Object.keys(ev.data).length > 0 && (
                    <div className="flex flex-col gap-1">
                      {Object.entries(ev.data).map(([k, v]) => (
                        <div key={k} className="flex items-baseline gap-2 bg-carbon/[0.025] dark:bg-white/[0.03] rounded-lg px-3 py-1.5">
                          <span className="text-[10px] font-mono font-semibold text-carbon/50 dark:text-white/40 whitespace-nowrap min-w-[80px]">{k}</span>
                          <span className="text-[11px] font-mono text-carbon dark:text-white break-all">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Separator between evidence items */}
                  {i < alert.evidence.length - 1 && (
                    <div className="border-t border-carbon/[0.04] dark:border-white/[0.04]" />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs font-mono opacity-40 py-2">No evidence data</p>
          )}
        </div>
      )}

      {tab === 'chain' && (
        <div className="space-y-4">
          {/* Attack Chain Graph */}
          <AlertAttackChain alertId={alert.id} autoExpand />

          {/* Event Timeline */}
          <EventChainTree alertId={alert.id} />
        </div>
      )}
    </div>
  );
}

// ── Main AlertCard ──────────────────────────────────────────────────────────

export function AlertCard({
  alert,
  onAcknowledge,
  onResolve,
  onMarkFalsePositive,
  compact = false,
  tableRow = false,
  endpointLabel,
}: AlertCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (compact) {
    return <CompactAlertCard alert={alert} />;
  }

  const Icon = catIcon(alert.category);
  const isNew = 'isNew' in alert && alert.isNew;

  const epLabel = endpointLabel
    ?? (alert.endpoint_user
      ? `${alert.endpoint_user}@${alert.endpoint_hostname || '?'}`
      : alert.endpoint_hostname || '');

  const statusLabel = alert.status === 'false_positive' ? 'false +' : alert.status;
  const statusClass =
    alert.status === 'new' ? 'bg-severity-critical/[0.12] text-severity-critical' :
    alert.status === 'investigating' ? 'bg-severity-medium/[0.12] text-severity-medium' :
    alert.status === 'resolved' ? 'bg-green-500/[0.12] text-green-600' :
    'bg-carbon/[0.06] opacity-50';

  // ── Table-row variant (grid-cols-12, for LiveFeed) ─────────────────
  if (tableRow) {
    return (
      <div className={cn(
        'transition-colors',
        isNew && 'bg-paper-dark animate-fade-in',
        isExpanded && 'bg-carbon/[0.02]',
        alert.status === 'resolved' && 'opacity-40',
        alert.status === 'false_positive' && 'opacity-30',
      )}>
        <div
          className="grid grid-cols-12 gap-3 px-4 py-3 items-center cursor-pointer hover:bg-paper-dark transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {/* Severity */}
          <div className="col-span-1">
            <span className={cn('inline-block text-[10px] font-bold rounded-full px-2 py-0.5 uppercase',
              alert.severity === 'critical' ? 'bg-severity-critical/[0.12] text-severity-critical' :
              alert.severity === 'high' ? 'bg-[#C4516C]/[0.12] text-[#C4516C]' :
              alert.severity === 'medium' ? 'bg-severity-medium/[0.12] text-severity-medium' :
              alert.severity === 'low' ? 'bg-carbon/[0.08] text-carbon/60' :
              'bg-carbon/[0.06] text-carbon/40'
            )}>
              {alert.severity}
            </span>
          </div>

          {/* Alert title + policy */}
          <div className="col-span-3 min-w-0">
            <div className="flex items-center gap-2">
              <Icon className="w-3.5 h-3.5 opacity-30 flex-shrink-0" />
              <p className="text-sm font-medium truncate">{alert.title}</p>
              {alert.blocked && (
                <span className="text-[9px] font-bold rounded-full bg-severity-critical/[0.12] text-severity-critical px-1.5 py-0.5 flex-shrink-0">BLOCKED</span>
              )}
            </div>
            {alert.policy_name && (
              <p className="text-[10px] font-mono opacity-35 mt-0.5 ml-[22px] truncate">{alert.policy_name}</p>
            )}
          </div>

          {/* Status */}
          <div className="col-span-1">
            <span className={cn('inline-block text-[10px] font-bold rounded-full px-2 py-0.5 uppercase', statusClass)}>
              {statusLabel}
            </span>
          </div>

          {/* Time */}
          <div className="col-span-2">
            <TimeAgo date={alert.created_at} className="text-xs font-mono opacity-50" />
          </div>

          {/* Endpoint */}
          <div className="col-span-2 truncate">
            {epLabel ? (
              <span className="text-xs font-mono opacity-50">{epLabel}</span>
            ) : (
              <span className="text-xs opacity-30">&mdash;</span>
            )}
          </div>

          {/* Session */}
          <div className="col-span-1 truncate">
            <span className="text-xs font-mono opacity-50">{alert.session_id.slice(0, 8)}</span>
          </div>

          {/* Expand */}
          <div className="col-span-2 flex justify-end">
            <ChevronRight className={cn(
              'w-3.5 h-3.5 opacity-30 transition-transform',
              isExpanded && 'rotate-90'
            )} />
          </div>
        </div>

        {isExpanded && (
          <AlertExpandContent
            alert={alert}
            onAcknowledge={onAcknowledge}
            onResolve={onResolve}
            onMarkFalsePositive={onMarkFalsePositive}
          />
        )}
      </div>
    );
  }

  // ── Default flex variant (Alerts page) ─────────────────────────────
  return (
    <div className={cn(
      'border-t',
      alert.status === 'resolved' && 'opacity-40',
      alert.status === 'false_positive' && 'opacity-30',
    )}>
      {/* Row */}
      <div
        className="px-4 py-3 flex items-center gap-4 cursor-pointer hover:bg-carbon/[0.02] transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <Icon className="w-4 h-4 opacity-30 flex-shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{alert.title}</p>
            {alert.blocked && (
              <span className="text-[9px] font-bold rounded-full bg-severity-critical/[0.12] text-severity-critical px-1.5 py-0.5">BLOCKED</span>
            )}
          </div>
          <p className="text-xs opacity-40 mt-0.5">
            {alert.policy_name && <span className="font-mono">{alert.policy_name} &mdash; </span>}
            <TimeAgo date={alert.created_at} className="opacity-100" />
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {epLabel && (
            <span className="text-[10px] font-mono opacity-40 px-1.5 py-0.5 rounded bg-carbon/[0.05]">
              {epLabel}
            </span>
          )}
          <code className="text-[10px] opacity-30">{alert.session_id.slice(0, 12)}</code>
        </div>

        <ChevronRight className={cn(
          'w-3.5 h-3.5 opacity-30 transition-transform flex-shrink-0',
          isExpanded && 'rotate-90'
        )} />
      </div>

      {/* Expand */}
      {isExpanded && (
        <AlertExpandContent
          alert={alert}
          onAcknowledge={onAcknowledge}
          onResolve={onResolve}
          onMarkFalsePositive={onMarkFalsePositive}
        />
      )}
    </div>
  );
}

// ── Skeleton ────────────────────────────────────────────────────────────────

export function AlertCardSkeleton() {
  return (
    <div className="px-4 py-3 border-t flex items-center gap-4 animate-pulse">
      <div className="w-4 h-4 rounded-full bg-carbon/10" />
      <div className="flex-1">
        <div className="h-4 rounded bg-carbon/10 w-64 mb-1" />
        <div className="h-3 rounded bg-carbon/10 w-40" />
      </div>
      <div className="h-3 rounded bg-carbon/10 w-20" />
    </div>
  );
}

export default AlertCard;
