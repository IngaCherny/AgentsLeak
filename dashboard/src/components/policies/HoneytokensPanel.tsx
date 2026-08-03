import { useState } from 'react';
import {
  Loader2,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  FileText,
  KeyRound,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useHoneytokens,
  useCreateHoneytoken,
  useToggleHoneytoken,
  useDeleteHoneytoken,
} from '@/api/queries';
import type { Honeytoken } from '@/api/types';

function KindBadge({ kind }: { kind: string }) {
  const isPath = kind === 'path';
  const Icon = isPath ? FileText : KeyRound;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide',
        isPath
          ? 'bg-risk-medium/10 text-risk-medium'
          : 'bg-risk-high/10 text-risk-high',
      )}
    >
      <Icon className="w-3 h-3" />
      {kind}
    </span>
  );
}

function HoneytokenRow({ token }: { token: Honeytoken }) {
  const toggle = useToggleHoneytoken();
  const del = useDeleteHoneytoken();

  return (
    <div
      className={cn(
        'px-4 py-3 flex items-center gap-4 border-b border-carbon/[0.06] last:border-b-0',
        !token.enabled && 'opacity-40',
      )}
    >
      <KindBadge kind={token.kind} />

      <div className="flex-1 min-w-0">
        <code className="text-[12px] font-mono text-alert-red break-all">{token.pattern}</code>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-xs opacity-40 truncate">{token.label}</p>
          {token.builtin && (
            <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wide opacity-40">
              <Lock className="w-2.5 h-2.5" /> built-in
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => toggle.mutate({ id: token.id, enabled: !token.enabled })}
          disabled={toggle.isPending}
          title={token.enabled ? 'Disable decoy' : 'Enable decoy'}
          className="p-1 hover:bg-carbon/[0.04] transition-colors"
        >
          {toggle.isPending ? (
            <Loader2 className="w-5 h-5 opacity-40 animate-spin" />
          ) : token.enabled ? (
            <ToggleRight className="w-5 h-5 text-carbon dark:text-white" />
          ) : (
            <ToggleLeft className="w-5 h-5 opacity-40" />
          )}
        </button>
        <button
          onClick={() => {
            if (window.confirm('Delete this decoy?')) del.mutate(token.id);
          }}
          disabled={token.builtin || del.isPending}
          title={token.builtin ? 'Built-in decoys can only be disabled' : 'Delete decoy'}
          className={cn(
            'p-1 transition-colors',
            token.builtin
              ? 'opacity-20 cursor-not-allowed'
              : 'opacity-40 hover:bg-carbon/[0.04] hover:text-risk-critical',
          )}
        >
          {del.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

function AddDecoyForm() {
  const create = useCreateHoneytoken();
  const [kind, setKind] = useState<'path' | 'value'>('value');
  const [pattern, setPattern] = useState('');
  const [label, setLabel] = useState('');

  const submit = async () => {
    if (!pattern.trim()) return;
    try {
      await create.mutateAsync({ kind, pattern: pattern.trim(), label: label.trim() });
      setPattern('');
      setLabel('');
    } catch {
      // surfaced via create.isError
    }
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Plus className="w-4 h-4 opacity-40" />
        <h3 className="text-sm font-bold text-carbon dark:text-white">Add a decoy</h3>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          className="input sm:w-32"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'path' | 'value')}
        >
          <option value="value">value</option>
          <option value="path">path</option>
        </select>
        <input
          className="input flex-1 font-mono text-sm"
          placeholder={kind === 'path' ? 'regex, e.g. secrets/vault_prod\\.json' : 'literal secret, e.g. sk_live_DECOY_9911'}
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <input
          className="input flex-1 text-sm"
          placeholder="label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button
          onClick={submit}
          disabled={!pattern.trim() || create.isPending}
          className="btn btn-primary flex items-center gap-2 justify-center"
        >
          {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Add
        </button>
      </div>
      <p className="text-[11px] opacity-40 leading-relaxed">
        <span className="font-mono font-semibold">path</span> — a regex matched against file paths and
        commands (reads and <span className="font-mono">cat</span>/<span className="font-mono">curl</span> alike).{' '}
        <span className="font-mono font-semibold">value</span> — a literal secret flagged anywhere it
        appears: a path, command, URL, or skill argument.
      </p>
      {create.isError && (
        <div className="text-sm text-risk-critical bg-risk-critical/[0.06] rounded-lg p-2">
          {(create.error as Error)?.message || 'Failed to add decoy'}
        </div>
      )}
    </div>
  );
}

export default function HoneytokensPanel() {
  const { data: tokens, isLoading, isError, error } = useHoneytokens();
  const list = tokens || [];
  const activeCount = list.filter((t) => t.enabled).length;

  return (
    <div className="space-y-4">
      {/* Explainer */}
      <div className="card p-4 bg-carbon/[0.02] dark:bg-white/[0.02]">
        <div className="flex items-start gap-3">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-[10px] bg-risk-critical/10 flex-shrink-0">
            <KeyRound className="w-4.5 h-4.5 text-risk-critical" />
          </div>
          <div className="text-sm leading-relaxed">
            <p className="font-medium text-carbon dark:text-white">Honeytokens — decoy secrets</p>
            <p className="opacity-50 mt-0.5">
              Files and values a legitimate agent never touches. Any access is a zero-false-positive
              CRITICAL signal. Detection is always on; a policy with{' '}
              <code className="font-mono text-alert-red">honeytoken: true</code> decides whether to
              alert or block. <span className="opacity-80">{activeCount} of {list.length} active.</span>
            </p>
          </div>
        </div>
      </div>

      <AddDecoyForm />

      {isError ? (
        <div className="card p-6 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-risk-critical" />
          <p className="text-sm">Failed to load honeytokens: {(error as Error)?.message || 'Unknown error'}</p>
        </div>
      ) : isLoading ? (
        <div className="card p-8 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin opacity-40" />
        </div>
      ) : list.length === 0 ? (
        <div className="card p-8 text-center opacity-50 text-sm">No honeytokens defined.</div>
      ) : (
        <div className="card overflow-hidden">
          {list.map((token) => (
            <HoneytokenRow key={token.id} token={token} />
          ))}
        </div>
      )}
    </div>
  );
}
