import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield,
  Plus,
  Search,
  Edit2,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertTriangle,
  ShieldOff,
  RefreshCw,
  X,
  Eye,
  Terminal,
  FileText,
  Globe,
  Zap,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePolicies, useTogglePolicy, useDeletePolicy, useCreatePolicy, usePolicyAssistantStatus } from '@/api/queries';
import type { Policy } from '@/api/types';
import PolicyAssistant from '@/components/policies/PolicyAssistant';

// ─── Helpers ────────────────────────────────────────────────────────────────

const sevStyle = (sev: string) => {
  switch (sev) {
    case 'critical': return 'text-severity-critical';
    case 'high': return 'text-severity-high';
    case 'medium': return 'text-severity-medium';
    default: return 'opacity-50';
  }
};

const catIcon = (cat: string) => {
  if (cat.includes('command')) return Terminal;
  if (cat.includes('file')) return FileText;
  if (cat.includes('network')) return Globe;
  return Zap;
};

function ConditionRules({ policy }: { policy: Policy }) {
  if (!policy.conditions || policy.conditions.length === 0) return null;
  const connector = policy.condition_logic === 'any' ? 'OR' : 'AND';
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[9px] font-mono font-semibold uppercase tracking-wider opacity-40">
        {policy.condition_logic === 'any' ? 'Any' : 'All'} must match
      </span>
      {policy.conditions.map((c, i) => (
        <div key={i}>
          <div className="flex items-center gap-2 bg-carbon/[0.03] dark:bg-white/[0.03] rounded-lg px-3 py-2">
            <span className="text-[11px] font-mono font-semibold text-carbon dark:text-white whitespace-nowrap">{c.field}</span>
            <span className="text-[9px] font-mono font-medium text-white bg-carbon dark:bg-white/20 dark:text-white/80 rounded px-1.5 py-0.5 whitespace-nowrap">{c.operator}</span>
            <span className="text-[11px] font-mono font-medium text-alert-red break-all">{typeof c.value === 'string' ? c.value : JSON.stringify(c.value)}</span>
          </div>
          {i < policy.conditions.length - 1 && (
            <p className="text-[9px] font-mono font-bold text-carbon/25 dark:text-white/20 text-center tracking-wider py-0.5">{connector}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Stats Cards ────────────────────────────────────────────────────────────

function StatsCards({ policies }: { policies: Policy[] }) {
  const total = policies.length;
  const blockCount = policies.filter(p => p.action === 'block').length;
  const alertCount = policies.filter(p => p.action === 'alert').length;
  const enabledCount = policies.filter(p => p.enabled).length;

  return (
    <div className="grid grid-cols-4 gap-3">
      <div className="card p-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-[10px] bg-carbon/[0.08] flex items-center justify-center">
          <Shield className="w-5 h-5 text-carbon/60" />
        </div>
        <div>
          <p className="text-xl font-bold text-carbon">{total}</p>
          <p className="text-[10px] font-mono opacity-40 uppercase">Total Rules</p>
        </div>
      </div>
      <div className="card p-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-[10px] bg-[#D90429]/[0.12] flex items-center justify-center">
          <ShieldOff className="w-5 h-5 text-[#D90429]" />
        </div>
        <div>
          <p className="text-xl font-bold text-severity-critical">{blockCount}</p>
          <p className="text-[10px] font-mono opacity-40 uppercase">Block Rules</p>
        </div>
      </div>
      <div className="card p-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-[10px] bg-amber-500/[0.12] flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
        </div>
        <div>
          <p className="text-xl font-bold text-severity-medium">{alertCount}</p>
          <p className="text-[10px] font-mono opacity-40 uppercase">Alert Rules</p>
        </div>
      </div>
      <div className="card p-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-[10px] bg-green-500/[0.12] flex items-center justify-center">
          <Eye className="w-5 h-5 text-green-500" />
        </div>
        <div>
          <p className="text-xl font-bold text-green-600">{enabledCount}</p>
          <p className="text-[10px] font-mono opacity-40 uppercase">Active</p>
        </div>
      </div>
    </div>
  );
}

// ─── Policy Row ─────────────────────────────────────────────────────────────

interface PolicyRowProps {
  policy: Policy;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  isToggling?: boolean;
  isDeleting?: boolean;
}

function PolicyRow({ policy, onToggle, onDelete, isToggling, isDeleting }: PolicyRowProps) {
  const [expanded, setExpanded] = useState(false);
  const CatIcon = policy.categories.length > 0 ? catIcon(policy.categories[0]) : Zap;

  return (
    <div className={cn('border-b border-carbon/[0.06] last:border-b-0', !policy.enabled && 'opacity-40')}>
      {/* Main row */}
      <div
        className="px-4 py-3 flex items-center gap-4 cursor-pointer hover:bg-carbon/[0.02] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight className={cn('w-3.5 h-3.5 opacity-30 transition-transform flex-shrink-0', expanded && 'rotate-90')} />

        <CatIcon className="w-4 h-4 opacity-30 flex-shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-carbon">{policy.name}</p>
            <span className={cn('text-[10px] font-bold uppercase', sevStyle(policy.severity))}>{policy.severity}</span>
          </div>
          <p className="text-xs opacity-40 truncate mt-0.5">{policy.description}</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {policy.tags?.slice(0, 2).map(t => (
            <code key={t} className="text-[10px] rounded-full bg-carbon/[0.04] px-1.5 py-0.5 opacity-50">{t}</code>
          ))}
        </div>

        {/* Hit count badge */}
        <div className="flex-shrink-0" onClick={e => e.stopPropagation()}>
          {(policy.hit_count ?? 0) > 0 ? (
            <Link
              to={`/alerts?rule_id=${policy.id}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-severity-critical/10 text-severity-critical hover:bg-severity-critical/20 transition-colors"
            >
              {policy.hit_count} {policy.hit_count === 1 ? 'hit' : 'hits'}
            </Link>
          ) : (
            <span className="text-[11px] font-mono opacity-20 px-2">0 hits</span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onToggle(policy.id, !policy.enabled)}
            disabled={isToggling}
            className="p-1 hover:bg-carbon/[0.04] transition-colors"
          >
            {isToggling ? (
              <Loader2 className="w-5 h-5 opacity-40 animate-spin" />
            ) : policy.enabled ? (
              <ToggleRight className="w-5 h-5 text-green-600" />
            ) : (
              <ToggleLeft className="w-5 h-5 opacity-30" />
            )}
          </button>
          <button className="p-1 hover:bg-carbon/[0.04] transition-colors opacity-30 hover:opacity-100 hover:text-alert-red">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              if (window.confirm('Delete this policy?')) onDelete(policy.id);
            }}
            disabled={isDeleting}
            className="p-1 hover:bg-carbon/[0.04] transition-colors opacity-30 hover:text-severity-critical"
          >
            {isDeleting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 animate-fade-in">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs font-mono opacity-40 uppercase mb-1">Categories</p>
              <div className="flex gap-1 flex-wrap">
                {policy.categories.length > 0
                  ? policy.categories.map(c => (
                      <code key={c} className="text-xs rounded-full bg-carbon/[0.06] px-2 py-0.5 font-mono">{c}</code>
                    ))
                  : <span className="text-xs opacity-40">All</span>
                }
              </div>
            </div>
            <div>
              <p className="text-xs font-mono opacity-40 uppercase mb-1">Action</p>
              <span className="text-xs font-bold uppercase">{policy.action}</span>
            </div>
            <div>
              <p className="text-xs font-mono opacity-40 uppercase mb-1">Condition Logic</p>
              <span className="text-xs font-mono opacity-60">{policy.condition_logic?.toUpperCase() || 'ALL'} must match</span>
            </div>
          </div>

          {policy.conditions && policy.conditions.length > 0 && (
            <div>
              <p className="text-xs font-mono opacity-40 uppercase mb-1">Detection Conditions</p>
              <ConditionRules policy={policy} />
            </div>
          )}

          {policy.tags && policy.tags.length > 0 && (
            <div>
              <p className="text-xs font-mono opacity-40 uppercase mb-1">Tags</p>
              <div className="flex gap-1.5 flex-wrap">
                {policy.tags.map(t => (
                  <span key={t} className="rounded-full bg-carbon/[0.04] px-2 py-0.5 text-xs font-mono">{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────────────────

function GroupSkeleton() {
  return (
    <div className="card animate-pulse">
      <div className="p-4 flex items-center justify-between bg-carbon/[0.02]">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full bg-carbon/10" />
          <div className="w-3 h-3 rounded-full bg-carbon/10" />
          <div>
            <div className="h-4 rounded bg-carbon/10 w-32 mb-1" />
            <div className="h-3 rounded bg-carbon/10 w-48" />
          </div>
        </div>
        <div className="h-6 w-8 rounded bg-carbon/10" />
      </div>
      {[...Array(3)].map((_, i) => (
        <div key={i} className="px-4 py-3 border-t flex items-center gap-4">
          <div className="h-4 w-4 rounded bg-carbon/10" />
          <div className="flex-1">
            <div className="h-4 rounded bg-carbon/10 w-48 mb-1" />
            <div className="h-3 rounded bg-carbon/10 w-64" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Create Policy Modal ────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  { value: 'file_read', label: 'File Read' },
  { value: 'file_write', label: 'File Write' },
  { value: 'file_delete', label: 'File Delete' },
  { value: 'command_exec', label: 'Command Exec' },
  { value: 'network_access', label: 'Network Access' },
  { value: 'code_execution', label: 'Code Execution' },
];

const SEVERITY_OPTIONS = ['critical', 'high', 'medium', 'low', 'info'];
const ACTION_OPTIONS = ['alert', 'block', 'log'];
const OPERATOR_OPTIONS = ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'matches', 'in', 'not_in'];

interface CreatePolicyModalProps {
  open: boolean;
  onClose: () => void;
}

function CreatePolicyModal({ open, onClose }: CreatePolicyModalProps) {
  const createMutation = useCreatePolicy();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [action, setAction] = useState('alert');
  const [severity, setSeverity] = useState('medium');
  const [conditionLogic, setConditionLogic] = useState('all');
  const [tags, setTags] = useState('');

  const [conditions, setConditions] = useState<{ field: string; operator: string; value: string; case_sensitive: boolean }[]>([
    { field: '', operator: 'matches', value: '', case_sensitive: true },
  ]);

  const addCondition = () => {
    setConditions([...conditions, { field: '', operator: 'matches', value: '', case_sensitive: true }]);
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const updateCondition = (index: number, key: string, value: string | boolean) => {
    const updated = [...conditions];
    updated[index] = { ...updated[index], [key]: value };
    setConditions(updated);
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setCategories([]);
    setAction('alert');
    setSeverity('medium');
    setConditionLogic('all');
    setTags('');
    setConditions([{ field: '', operator: 'matches', value: '', case_sensitive: true }]);
  };

  const handleSubmit = async () => {
    const validConditions = conditions.filter(c => c.field && c.value);
    try {
      await createMutation.mutateAsync({
        name,
        description,
        categories,
        action,
        severity,
        condition_logic: conditionLogic,
        conditions: validConditions,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        alert_title: name,
        alert_description: description,
        enabled: true,
      } as unknown as Partial<Policy>);
      resetForm();
      onClose();
    } catch {
      // error is shown via createMutation.isError
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/40">
      <div className="bg-white rounded-2xl shadow-[0_2px_6px_rgba(0,0,0,0.06),0_16px_48px_rgba(0,0,0,0.12)] w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-carbon/10">
          <h2 className="font-display font-bold text-lg">CREATE POLICY</h2>
          <button onClick={onClose} className="p-1 hover:text-alert-red"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-mono uppercase opacity-50 mb-1">Name *</label>
            <input className="input w-full" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Block crypto mining" />
          </div>

          <div>
            <label className="block text-xs font-mono uppercase opacity-50 mb-1">Description</label>
            <textarea className="input w-full h-20 resize-none" value={description} onChange={e => setDescription(e.target.value)} placeholder="What this policy detects..." />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono uppercase opacity-50 mb-1">Action</label>
              <select className="input w-full" value={action} onChange={e => setAction(e.target.value)}>
                {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-mono uppercase opacity-50 mb-1">Severity</label>
              <select className="input w-full" value={severity} onChange={e => setSeverity(e.target.value)}>
                {SEVERITY_OPTIONS.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase opacity-50 mb-1">Categories</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map(cat => (
                <label key={cat.value} className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 cursor-pointer text-xs font-mono transition-all',
                  categories.includes(cat.value) ? 'bg-carbon text-white shadow-sm' : 'bg-carbon/[0.04] opacity-50 hover:opacity-100'
                )}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={categories.includes(cat.value)}
                    onChange={e => {
                      if (e.target.checked) setCategories([...categories, cat.value]);
                      else setCategories(categories.filter(c => c !== cat.value));
                    }}
                  />
                  {cat.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-mono uppercase opacity-50">Conditions</label>
              <div className="flex items-center gap-2">
                <select className="input text-xs py-1" value={conditionLogic} onChange={e => setConditionLogic(e.target.value)}>
                  <option value="all">ALL must match</option>
                  <option value="any">ANY must match</option>
                </select>
                <button onClick={addCondition} className="text-xs font-mono opacity-50 hover:opacity-100 hover:text-alert-red">+ Add</button>
              </div>
            </div>
            <div className="space-y-2">
              {conditions.map((cond, i) => (
                <div key={i} className="flex items-center gap-2 bg-carbon/[0.03] rounded-lg p-2">
                  <input className="input flex-1 text-sm" placeholder="field (e.g. tool_input.command)" value={cond.field} onChange={e => updateCondition(i, 'field', e.target.value)} />
                  <select className="input w-32 text-sm" value={cond.operator} onChange={e => updateCondition(i, 'operator', e.target.value)}>
                    {OPERATOR_OPTIONS.map(op => <option key={op} value={op}>{op}</option>)}
                  </select>
                  <input className="input flex-1 text-sm" placeholder="value / regex" value={cond.value} onChange={e => updateCondition(i, 'value', e.target.value)} />
                  <label className="flex items-center gap-1 text-xs opacity-50 whitespace-nowrap">
                    <input type="checkbox" checked={cond.case_sensitive} onChange={e => updateCondition(i, 'case_sensitive', e.target.checked)} />
                    Aa
                  </label>
                  {conditions.length > 1 && (
                    <button onClick={() => removeCondition(i)} className="text-xs opacity-40 hover:text-alert-red"><X className="w-3 h-3" /></button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase opacity-50 mb-1">Tags (comma-separated)</label>
            <input className="input w-full" value={tags} onChange={e => setTags(e.target.value)} placeholder="e.g. credentials, exfiltration" />
          </div>

          {createMutation.isError && (
            <div className="text-sm text-severity-critical bg-severity-critical/[0.06] rounded-lg p-2">
              Failed to create policy: {(createMutation.error as Error)?.message || 'Unknown error'}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-carbon/10">
            <button onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={!name || createMutation.isPending}
              className="btn btn-primary flex items-center gap-2"
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Policy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

interface PolicyGroup {
  key: string;
  label: string;
  desc: string;
  bgClass: string;
  badgeBg: string;
  dotColor: string;
  policies: Policy[];
}

export default function Policies() {
  const [activeTab, setActiveTab] = useState<'rules' | 'assistant'>('rules');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data: policies, isLoading, isError, error, refetch, isFetching } = usePolicies();
  const { data: assistantStatus } = usePolicyAssistantStatus();
  const toggleMutation = useTogglePolicy();
  const deleteMutation = useDeletePolicy();
  const assistantAvailable = assistantStatus?.available ?? false;

  const allPolicies = policies || [];

  // Apply search filter
  const filtered = allPolicies.filter(p => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags?.some(t => t.toLowerCase().includes(q))
    );
  });

  // Group policies by action type
  const groups: PolicyGroup[] = [
    {
      key: 'block',
      label: 'Block Rules',
      desc: 'These rules immediately halt dangerous operations',
      bgClass: 'bg-severity-critical/[0.04]',
      badgeBg: 'bg-severity-critical text-white border-severity-critical',
      dotColor: 'bg-severity-critical',
      policies: filtered.filter(p => p.action === 'block'),
    },
    {
      key: 'alert',
      label: 'Alert Rules',
      desc: 'These rules flag suspicious activity for review',
      bgClass: 'bg-severity-medium/[0.04]',
      badgeBg: 'bg-severity-medium text-white border-severity-medium',
      dotColor: 'bg-severity-medium',
      policies: filtered.filter(p => p.action === 'alert'),
    },
    {
      key: 'log',
      label: 'Monitor Rules',
      desc: 'Low-priority rules for visibility and auditing',
      bgClass: 'bg-carbon/[0.02]',
      badgeBg: 'bg-carbon/10 border-carbon/20',
      dotColor: 'bg-carbon/30',
      policies: filtered.filter(p => p.action === 'log'),
    },
  ];

  const toggleGroup = (key: string) => {
    const next = new Set(collapsedGroups);
    if (next.has(key)) next.delete(key); else next.add(key);
    setCollapsedGroups(next);
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    setTogglingId(id);
    try {
      await toggleMutation.mutateAsync({ id, enabled });
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteMutation.mutateAsync(id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab Switcher + Header Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Tabs */}
          <div className="flex items-center rounded-lg bg-carbon/[0.04] p-0.5">
            <button
              onClick={() => setActiveTab('rules')}
              className={cn(
                'px-3.5 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-1.5',
                activeTab === 'rules'
                  ? 'bg-white text-carbon shadow-sm'
                  : 'text-carbon/50 hover:text-carbon/70'
              )}
            >
              <Shield className="w-3.5 h-3.5" />
              Rules
            </button>
            {assistantAvailable && (
              <button
                onClick={() => setActiveTab('assistant')}
                className={cn(
                  'px-3.5 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-1.5',
                  activeTab === 'assistant'
                    ? 'bg-white text-carbon shadow-sm'
                    : 'text-carbon/50 hover:text-carbon/70'
                )}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Policy Assistant
              </button>
            )}
          </div>

          {activeTab === 'rules' && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
              <input
                type="text"
                placeholder="Search policies..."
                className="input-search pl-9 w-64"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-60"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {activeTab === 'rules' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="btn btn-secondary flex items-center gap-2"
            >
              <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
              Refresh
            </button>
            <button onClick={() => setShowCreateModal(true)} className="btn btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Create Policy
            </button>
          </div>
        )}
      </div>

      {activeTab === 'assistant' ? (
        <PolicyAssistant />
      ) : (
        <>
          {/* Stats Cards */}
          {!isLoading && !isError && <StatsCards policies={allPolicies} />}

          {/* Error State */}
          {isError && (
            <div className="card p-6">
              <div className="flex items-center gap-3 text-carbon">
                <AlertTriangle className="w-5 h-5 text-carbon" />
                <p>Failed to load policies: {(error as Error)?.message || 'Unknown error'}</p>
              </div>
              <button onClick={() => refetch()} className="mt-4 btn btn-secondary text-sm">
                Try Again
              </button>
            </div>
          )}

          {/* Grouped Sections */}
          {!isError && (
            <div className="space-y-4">
              {isLoading ? (
                <>
                  <GroupSkeleton />
                  <GroupSkeleton />
                </>
              ) : allPolicies.length === 0 ? (
                <div className="card p-12 text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-[10px] bg-carbon/[0.06] mb-4">
                    <Shield className="w-8 h-8 opacity-40" />
                  </div>
                  <h3 className="text-lg font-medium opacity-60 mb-2">No policies configured</h3>
                  <p className="opacity-50 mb-4">Create your first policy to start monitoring AI agent behavior.</p>
                  <button onClick={() => setShowCreateModal(true)} className="btn btn-primary flex items-center gap-2 mx-auto">
                    <Plus className="w-4 h-4" />
                    Create Policy
                  </button>
                </div>
              ) : (
                groups
                  .filter(group => group.policies.length > 0)
                  .map(group => {
                    const isCollapsed = collapsedGroups.has(group.key);
                    const enabledCount = group.policies.filter(p => p.enabled).length;
                    return (
                      <div key={group.key} className="card">
                        {/* Group header */}
                        <div
                          className={cn('p-4 flex items-center justify-between cursor-pointer transition-colors', group.bgClass)}
                          onClick={() => toggleGroup(group.key)}
                        >
                          <div className="flex items-center gap-3">
                            {isCollapsed
                              ? <ChevronRight className="w-4 h-4" />
                              : <ChevronDown className="w-4 h-4" />
                            }
                            <div className={cn('w-3 h-3 rounded-full', group.dotColor)} />
                            <div>
                              <h3 className="font-bold text-sm text-carbon">{group.label}</h3>
                              <p className="text-xs opacity-40">{group.desc}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs opacity-50">{enabledCount}/{group.policies.length} enabled</span>
                            <span className={cn('px-2.5 py-0.5 text-xs font-bold rounded-full', group.badgeBg)}>
                              {group.policies.length}
                            </span>
                          </div>
                        </div>

                        {/* Group content */}
                        {!isCollapsed && (
                          <div>
                            {group.policies.map(policy => (
                              <PolicyRow
                                key={policy.id}
                                policy={policy}
                                onToggle={handleToggle}
                                onDelete={handleDelete}
                                isToggling={togglingId === policy.id}
                                isDeleting={deletingId === policy.id}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          )}

          <CreatePolicyModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />
        </>
      )}
    </div>
  );
}
