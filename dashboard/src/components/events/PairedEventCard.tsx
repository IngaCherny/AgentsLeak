import { useState } from 'react';
import {
  FileText,
  FileEdit,
  Trash2,
  Terminal,
  Globe,
  Code,
  Wrench,
  GitBranch,
  Layers,
  HelpCircle,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SeverityBadge } from '@/components/common/SeverityBadge';
import { Timestamp } from '@/components/common/TimeAgo';
import { Severity } from '@/api/types';
import type { EventPair, PairState } from './pairEvents';

interface PairedEventCardProps {
  pair: EventPair;
  endpointLabel?: string;
  showSession?: boolean;
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

const phaseFromState: Record<PairState, 'POST' | 'FAIL' | 'BLOCK' | 'PENDING'> = {
  done: 'POST',
  failed: 'FAIL',
  blocked: 'BLOCK',
  pending: 'PENDING',
};

function PhaseTag({
  phase,
}: {
  phase: 'PRE' | 'POST' | 'FAIL' | 'BLOCK' | 'PENDING';
}) {
  const cls =
    phase === 'FAIL' || phase === 'BLOCK'
      ? 'bg-alert-red/[0.12] dark:bg-alert-red/[0.20] text-alert-red'
      : phase === 'PRE'
      ? 'bg-carbon/10 text-carbon'
      : phase === 'POST'
      ? 'bg-carbon/[0.04] text-carbon/60'
      : 'bg-carbon/[0.04] text-carbon/40';
  return (
    <span
      className={cn(
        'inline-block text-[10px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
        cls,
      )}
    >
      {phase}
    </span>
  );
}

/** Pull a short result/error summary out of the post event's tool_result. */
function postSummary(pair: EventPair): string {
  if (pair.state === 'pending') return 'awaiting result…';
  if (pair.state === 'blocked') {
    const reason = (pair.pre.raw_payload as Record<string, unknown> | null)?.[
      'reason'
    ];
    if (typeof reason === 'string' && reason.length > 0) return reason;
    return 'Blocked by AgentsLeak policy';
  }
  const post = pair.post;
  if (!post) return 'completed';
  const result = post.tool_result as Record<string, unknown> | null | undefined;
  if (result) {
    if (typeof result.error === 'string') return result.error;
    if (typeof result.stderr === 'string' && result.stderr.length > 0) return result.stderr.slice(0, 160);
    if (typeof result.output === 'string') return result.output.slice(0, 160) || 'completed';
  }
  return 'completed';
}

/** Best-effort target string for the top row. */
function targetText(pair: EventPair): { text: string; prefix?: string } {
  const e = pair.pre;
  if (e.file_paths && e.file_paths.length > 0) return { text: e.file_paths[0] };
  if (e.commands && e.commands.length > 0) return { text: e.commands[0], prefix: '$ ' };
  if (e.urls && e.urls.length > 0) return { text: e.urls[0] };
  return { text: e.tool_name || e.hook_type || 'Unknown' };
}

export function PairedEventCard({
  pair,
  endpointLabel,
  showSession = true,
}: PairedEventCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = categoryIcons[pair.pre.category] || Code;
  const isProblem = pair.state === 'failed' || pair.state === 'blocked';
  const target = targetText(pair);
  const phase = phaseFromState[pair.state];

  return (
    <div className="px-4 py-2">
      <div
        className={cn(
          'card-sm overflow-hidden cursor-pointer',
          isProblem && 'border-l-4 border-l-alert-red',
        )}
        onClick={() => setExpanded((v) => !v)}
      >
        {/* PRE row */}
        <div className="grid grid-cols-12 gap-3 px-4 py-3 items-center hover:bg-paper-dark transition-colors">
          <div className={showSession ? 'col-span-1' : 'col-span-2'}>
            <Timestamp date={pair.pre.timestamp} />
          </div>
          {showSession && (
            <div className="col-span-2 truncate">
              {endpointLabel ? (
                <span className="text-xs font-mono opacity-50">{endpointLabel}</span>
              ) : (
                <span className="text-xs opacity-40">—</span>
              )}
            </div>
          )}
          {showSession && (
            <div className="col-span-1 truncate">
              <span className="text-xs font-mono opacity-50">
                {pair.pre.session_id.slice(0, 8)}
              </span>
            </div>
          )}
          <div className="col-span-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-carbon/[0.06]">
                <Icon className="w-3.5 h-3.5 opacity-50" />
              </div>
              <span className="text-sm opacity-60">
                {categoryLabels[pair.pre.category] || pair.pre.category}
              </span>
            </div>
          </div>
          <div className="col-span-1">
            <SeverityBadge severity={pair.severity as Severity} size="sm" />
          </div>
          <div className="col-span-4 opacity-80 text-sm min-w-0 overflow-hidden">
            <p className="text-sm font-mono truncate" title={target.text}>
              {target.prefix}
              {target.text}
            </p>
          </div>
          <div className="col-span-1 flex justify-end">
            <PhaseTag phase="PRE" />
          </div>
        </div>

        {/* Divider — flips red when the pair failed or blocked */}
        <div
          className={cn(
            'h-px',
            isProblem ? 'bg-alert-red/30' : 'bg-carbon/[0.06]',
          )}
        />

        {/* Post / Fail / Block / Pending row */}
        <div className="grid grid-cols-12 gap-3 px-4 py-2.5 items-center">
          <div className={showSession ? 'col-span-1' : 'col-span-2'}>
            {pair.post ? (
              <Timestamp date={pair.post.timestamp} className="opacity-30" />
            ) : (
              <span className="text-xs font-mono opacity-30">—</span>
            )}
          </div>
          {showSession && <div className="col-span-3" />}
          <div className="col-span-2 opacity-50 text-[11px] font-mono truncate" title={pair.pre.tool_name || ''}>
            {pair.pre.tool_name}
          </div>
          <div className="col-span-1" />
          <div
            className={cn(
              'col-span-4 min-w-0 text-xs font-mono truncate',
              isProblem ? 'text-alert-red' : 'opacity-50',
            )}
            title={postSummary(pair)}
          >
            {postSummary(pair)}
          </div>
          <div className="col-span-1 flex justify-end items-center gap-1">
            <PhaseTag phase={phase} />
            <ChevronDown
              className={cn(
                'w-3.5 h-3.5 opacity-40 transition-transform',
                expanded && 'rotate-180',
              )}
            />
          </div>
        </div>

        {/* Expanded payload view */}
        {expanded && (
          <div className="border-t border-carbon/[0.06] px-4 py-4 bg-carbon/[0.02] animate-fade-in space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="opacity-40 mb-1 text-[10px] font-mono uppercase tracking-wider">Pre Event ID</p>
                <p className="opacity-60 font-mono text-xs break-all">{pair.pre.id}</p>
              </div>
              <div>
                <p className="opacity-40 mb-1 text-[10px] font-mono uppercase tracking-wider">Post Event ID</p>
                <p className="opacity-60 font-mono text-xs break-all">
                  {pair.post ? pair.post.id : '—'}
                </p>
              </div>
              <div>
                <p className="opacity-40 mb-1 text-[10px] font-mono uppercase tracking-wider">tool_use_id</p>
                <p className="opacity-60 font-mono text-xs break-all">
                  {pair.pre.tool_use_id || '—'}
                </p>
              </div>
            </div>

            {pair.pre.tool_input && Object.keys(pair.pre.tool_input).length > 0 && (
              <div>
                <p className="opacity-40 mb-1 text-[10px] font-mono uppercase tracking-wider">Tool Input</p>
                <pre className="text-paper-dark dark:text-carbon font-mono text-xs bg-carbon dark:bg-paper-dark p-3 overflow-x-auto rounded">
                  {JSON.stringify(pair.pre.tool_input, null, 2)}
                </pre>
              </div>
            )}

            {pair.post?.tool_result && Object.keys(pair.post.tool_result).length > 0 && (
              <div>
                <p
                  className={cn(
                    'mb-1 text-[10px] font-mono uppercase tracking-wider',
                    isProblem ? 'text-alert-red' : 'opacity-40',
                  )}
                >
                  {isProblem ? 'Error' : 'Tool Result'}
                </p>
                <pre className="text-paper-dark dark:text-carbon font-mono text-xs bg-carbon dark:bg-paper-dark p-3 overflow-x-auto rounded">
                  {JSON.stringify(pair.post.tool_result, null, 2)}
                </pre>
              </div>
            )}

            {pair.state === 'blocked' && (
              <div>
                <p className="text-alert-red mb-1 text-[10px] font-mono uppercase tracking-wider">
                  Blocked — call never executed
                </p>
                <p className="text-sm">{postSummary(pair)}</p>
              </div>
            )}

            {pair.state === 'pending' && (
              <div>
                <p className="opacity-40 mb-1 text-[10px] font-mono uppercase tracking-wider">
                  Pending
                </p>
                <p className="text-sm opacity-60">
                  The matching PostToolUse hasn't arrived yet — either the tool
                  is still running, or it ran out of band.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default PairedEventCard;
