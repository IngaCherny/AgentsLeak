import { useState } from 'react';
import {
  Ban,
  ChevronRight,
  FileEdit,
  FileText,
  GitBranch,
  Globe,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SeverityBadge } from '@/components/common/SeverityBadge';
import type { ConversationStep } from '@/api/types';
import { Markdown } from './Markdown';

const toolIcons: Record<string, React.ElementType> = {
  Bash: Terminal,
  Read: FileText,
  Edit: FileEdit,
  MultiEdit: FileEdit,
  Write: FileEdit,
  NotebookEdit: FileEdit,
  Grep: Search,
  Glob: Search,
  WebFetch: Globe,
  WebSearch: Globe,
  Agent: GitBranch,
  Task: GitBranch,
  Skill: Sparkles,
};

export function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function isRisky(step: ConversationStep): boolean {
  return step.status === 'blocked' || step.alerts.length > 0 || step.children.some(isRisky);
}

/** Short result hint shown on the collapsed line ("+3 −1", "1 line", …). */
function resultHint(step: ConversationStep): string | null {
  const input = step.input ?? {};
  if (step.tool_name === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    const removed = input.old_string.split('\n').length;
    const added = input.new_string.split('\n').length;
    return `+${added} −${removed}`;
  }
  if (step.launched_agent_id) return step.children.length ? `${step.children.length} steps` : 'subagent';
  if (step.result_preview) {
    const lines = step.result_preview.trimEnd().split('\n').filter(Boolean).length;
    return lines === 0 ? null : lines === 1 ? step.result_preview.trim().slice(0, 40) : `${lines} lines`;
  }
  return null;
}

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-display font-bold uppercase tracking-wider opacity-40 mb-1">{label}</p>
      {children}
    </div>
  );
}

function CodePanel({ text }: { text: string }) {
  return (
    <pre className="code-block rounded-lg p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-80 overflow-auto">
      {text}
    </pre>
  );
}

function EditDiff({ oldText, newText }: { oldText: string; newText: string }) {
  return (
    <pre className="code-block rounded-lg p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-80 overflow-auto">
      {oldText.split('\n').map((line, i) => (
        <div key={`o${i}`} className="text-[#ff9b9b]">− {line}</div>
      ))}
      {newText.split('\n').map((line, i) => (
        <div key={`n${i}`} className="text-[#8fe0a8]">+ {line}</div>
      ))}
    </pre>
  );
}

interface StepRowProps {
  step: ConversationStep;
  domId: string;
  highlighted?: boolean;
  onlyRisky?: boolean;
  onShowAlerts?: () => void;
}

export function StepRow({ step, domId, highlighted, onlyRisky, onShowAlerts }: StepRowProps) {
  const [open, setOpen] = useState(false);
  const Icon = step.tool_name?.startsWith('mcp__') ? Wrench : toolIcons[step.tool_name ?? ''] ?? Wrench;
  const risky = isRisky(step);
  const hint = resultHint(step);
  const duration = formatDuration(step.duration_ms);
  const input = step.input ?? {};
  const isEdit =
    step.tool_name === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string';
  const children = onlyRisky ? step.children.filter(isRisky) : step.children;

  return (
    <div id={domId} className="relative scroll-mt-24">
      {risky && <span className="absolute -left-[13px] top-1 bottom-1 w-[3px] rounded-full bg-alert-red" />}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'w-full flex items-center gap-2 py-1.5 pr-2 text-left rounded-md transition-colors',
          'hover:bg-carbon/[0.03] dark:hover:bg-white/[0.04]',
          highlighted && 'ring-2 ring-alert-red/60'
        )}
      >
        <ChevronRight className={cn('w-3 h-3 shrink-0 opacity-30 transition-transform', open && 'rotate-90')} />
        <Icon className="w-3.5 h-3.5 shrink-0 opacity-50" />
        <span className="font-mono text-xs font-semibold text-carbon shrink-0">{step.tool_name ?? 'Tool'}</span>
        <span className="font-mono text-xs text-carbon/60 truncate min-w-0 flex-1">{step.summary}</span>

        {step.permission_requested && (
          <span className="shrink-0 text-[10px] font-display font-bold uppercase text-risk-medium-deep" title="Claude asked for permission">
            asked
          </span>
        )}
        {step.status === 'blocked' ? (
          <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-display font-bold uppercase text-alert-red">
            <Ban className="w-3 h-3" /> blocked
          </span>
        ) : step.status === 'error' ? (
          <span className="shrink-0 text-[11px] font-display font-bold uppercase text-risk-high-deep">failed</span>
        ) : step.status === 'pending' ? (
          <span className="shrink-0 text-[11px] font-mono opacity-50 animate-pulse">running…</span>
        ) : step.status === 'no_result' ? (
          <span className="shrink-0 text-[11px] font-mono opacity-40">no result</span>
        ) : (
          hint && <span className="shrink-0 max-w-[10rem] truncate text-[11px] font-mono opacity-40">{hint}</span>
        )}
        {duration && <span className="shrink-0 w-12 text-right text-[11px] font-mono tabular-nums opacity-30">{duration}</span>}
      </button>

      {step.alerts.length > 0 && (
        <div className="ml-10 mb-1 flex flex-wrap items-center gap-2">
          {step.alerts.map((alert) => (
            <button
              type="button"
              key={alert.id}
              onClick={onShowAlerts}
              title="Open this session's alerts"
              className="inline-flex items-center gap-1.5 text-xs text-alert-red hover:underline"
            >
              <SeverityBadge severity={alert.severity} size="sm" />
              {alert.title}
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="ml-10 mt-1 mb-3 space-y-3">
          {isEdit ? (
            <Panel label={`Edit · ${String(input.file_path ?? '')}`}>
              <EditDiff oldText={input.old_string as string} newText={input.new_string as string} />
            </Panel>
          ) : (
            step.input && <Panel label="Input"><CodePanel text={JSON.stringify(step.input, null, 2)} /></Panel>
          )}
          {step.error && <Panel label="Error"><CodePanel text={step.error} /></Panel>}
          {step.result_preview && (
            <Panel label={step.result_truncated ? 'Result (first 2,000 characters)' : 'Result'}>
              <CodePanel text={step.result_preview} />
            </Panel>
          )}
          {step.agent_reply && (
            <Panel label="Subagent reply">
              <Markdown text={step.agent_reply} className="text-sm text-carbon/80" />
            </Panel>
          )}
          <p className="text-[11px] font-mono opacity-30">
            {step.tool_use_id}
            {step.agent_type && ` · subagent: ${step.agent_type}`}
          </p>
        </div>
      )}

      {children.length > 0 && (
        <div className="ml-6 pl-3 border-l border-dashed border-carbon/15 dark:border-white/15">
          <p className="text-[10px] font-display font-bold uppercase tracking-wider opacity-40 pt-1 flex items-center gap-1">
            Subagent{step.children[0]?.agent_type ? ` · ${step.children[0].agent_type}` : ''}
          </p>
          {children.map((child, i) => (
            <StepRow
              key={child.tool_use_id ?? i}
              step={child}
              domId={`${domId}-${i}`}
              onlyRisky={onlyRisky}
              onShowAlerts={onShowAlerts}
            />
          ))}
        </div>
      )}
    </div>
  );
}
