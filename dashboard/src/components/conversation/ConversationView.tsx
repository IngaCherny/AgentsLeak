import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Bell, ChevronRight, Download, Info, Loader2, Search, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { queryKeys, useSessionConversation } from '@/api/queries';
import { useWebSocketEvent } from '@/hooks/useWebSocket';
import type {
  ConversationItem,
  ConversationStep,
  ConversationTurn,
  Event,
} from '@/api/types';
import { Markdown } from './Markdown';
import { StepRow, formatDuration, isRisky } from './StepRow';

// How long to wait for a burst of live events to settle before refetching.
const LIVE_REFRESH_MS = 800;

function clockTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function turnTitle(turn: ConversationTurn): string {
  if (turn.kind === 'session_start') return 'Before the first prompt';
  if (turn.kind === 'task_notification') return turn.task?.summary || 'Background task finished';
  return turn.prompt?.text?.trim() || 'Prompt not captured';
}

function isStep(item: ConversationItem): item is ConversationStep {
  return item.type === 'step';
}

function turnMatches(turn: ConversationTurn, query: string): boolean {
  const q = query.toLowerCase();
  const inStep = (s: ConversationStep): boolean =>
    s.summary.toLowerCase().includes(q) ||
    (s.tool_name ?? '').toLowerCase().includes(q) ||
    s.children.some(inStep);
  return (
    turnTitle(turn).toLowerCase().includes(q) ||
    (turn.reply?.text ?? '').toLowerCase().includes(q) ||
    turn.items.some((item) =>
      item.type === 'note' ? item.text.toLowerCase().includes(q) : isStep(item) && inStep(item)
    )
  );
}

function turnIsRisky(turn: ConversationTurn): boolean {
  return turn.counts.blocked > 0 || turn.counts.alerts > 0;
}

// ── Turn ────────────────────────────────────────────────────────────────────

interface TurnCardProps {
  turn: ConversationTurn;
  expanded: boolean;
  onToggle: () => void;
  onlyRisky: boolean;
  highlightedStep: string | null;
  onShowAlerts: () => void;
}

function TurnCard({ turn, expanded, onToggle, onlyRisky, highlightedStep, onShowAlerts }: TurnCardProps) {
  const risky = turnIsRisky(turn);
  const items = onlyRisky
    ? turn.items.filter((item) => isStep(item) && isRisky(item))
    : turn.items;
  const firstReplyLine = turn.reply?.text.split('\n').find((line) => line.trim())?.trim();
  const duration = formatDuration(turn.duration_ms);

  return (
    <div id={`turn-${turn.index}`} className="card-sm relative overflow-hidden scroll-mt-24">
      {risky && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-alert-red" />}

      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full text-left px-5 py-3 flex items-start gap-3 hover:bg-carbon/[0.02] dark:hover:bg-white/[0.03] transition-colors"
      >
        <ChevronRight className={cn('w-4 h-4 mt-0.5 shrink-0 opacity-30 transition-transform', expanded && 'rotate-90')} />
        <span className="shrink-0 w-14 pt-0.5 font-mono text-[11px] opacity-40 tabular-nums">
          TURN {turn.index}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-sm truncate',
              turn.kind === 'prompt' && turn.prompt ? 'font-medium text-carbon' : 'italic text-carbon/60'
            )}
          >
            {turn.kind === 'task_notification' && <Bell className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5 opacity-60" />}
            {turn.prompt?.slash_command && (
              <span className="mr-2 font-mono text-[11px] px-1.5 py-0.5 rounded bg-carbon/[0.06] dark:bg-white/[0.08]">
                /{turn.prompt.slash_command}
              </span>
            )}
            {turnTitle(turn)}
          </p>
          {!expanded && firstReplyLine && (
            <p className="mt-0.5 text-xs text-carbon/50 truncate">
              <span className="font-display font-semibold uppercase text-[10px] tracking-wider mr-1.5 opacity-70">Claude</span>
              {firstReplyLine}
            </p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-3 pt-0.5 text-[11px] font-mono tabular-nums">
          {turn.counts.blocked > 0 && (
            <span className="inline-flex items-center gap-1 text-alert-red font-semibold" title="Blocked tool calls">
              <Ban className="w-3 h-3" />
              {turn.counts.blocked}
            </span>
          )}
          {turn.counts.alerts > 0 && (
            <span className="inline-flex items-center gap-1 text-alert-red" title="Alerts">
              <ShieldAlert className="w-3 h-3" />
              {turn.counts.alerts}
            </span>
          )}
          {turn.counts.steps > 0 && (
            <span className="opacity-40">
              {turn.counts.steps} step{turn.counts.steps === 1 ? '' : 's'}
            </span>
          )}
          {turn.status === 'in_progress' ? (
            <span className="inline-flex items-center gap-1.5 opacity-60">
              <span className="w-1.5 h-1.5 rounded-full bg-carbon/60 dark:bg-white/60 animate-pulse" />
              working…
            </span>
          ) : (
            duration && <span className="w-12 text-right opacity-40">{duration}</span>
          )}
          <span className="hidden sm:inline w-16 text-right opacity-30">{clockTime(turn.started_at)}</span>
        </div>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-5 pb-5 pt-1 space-y-4">
          {turn.kind === 'prompt' && turn.prompt && (
            <div>
              <p className="mb-1.5 text-[10px] font-display font-bold uppercase tracking-wider opacity-40">You</p>
              <div className="chat-bubble-user rounded-xl px-4 py-3 text-sm whitespace-pre-wrap break-words">
                {turn.prompt.text}
              </div>
            </div>
          )}

          {turn.kind === 'task_notification' && turn.task && (
            <div className="rounded-xl border border-dashed border-carbon/15 dark:border-white/15 px-4 py-3 text-sm">
              <p className="text-[10px] font-display font-bold uppercase tracking-wider opacity-40 mb-1">
                Background task · {turn.task.status ?? 'finished'}
              </p>
              <p className="text-carbon/80">{turn.task.summary}</p>
              {turn.task.result && <Markdown text={turn.task.result} className="mt-2 text-xs text-carbon/60" />}
            </div>
          )}

          {items.length > 0 && (
            <div className="pl-3 space-y-0.5">
              {items.map((item, i) => {
                if (item.type === 'note') {
                  return (
                    <div key={`n${i}`} className="flex gap-2.5 pt-2 pb-1 text-[13px] text-carbon/65">
                      <span className="mt-[7px] w-1.5 h-1.5 shrink-0 rounded-full border border-carbon/40 dark:border-white/40" />
                      <Markdown text={item.text} className="min-w-0 flex-1" />
                    </div>
                  );
                }
                if (item.type === 'divider') {
                  return (
                    <div key={`d${i}`} className="flex items-center gap-3 py-2 text-[10px] font-mono uppercase tracking-wider opacity-40">
                      <span className="h-px flex-1 bg-carbon/15 dark:bg-white/15" />
                      context compacted
                      <span className="h-px flex-1 bg-carbon/15 dark:bg-white/15" />
                    </div>
                  );
                }
                const domId = `step-${turn.index}-${i}`;
                return (
                  <div key={item.tool_use_id ?? domId} className="pl-3">
                    <StepRow
                      step={item}
                      domId={domId}
                      highlighted={highlightedStep === domId}
                      onlyRisky={onlyRisky}
                      onShowAlerts={onShowAlerts}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {!onlyRisky && turn.reply && (
            <div>
              <p className="mb-1.5 text-[10px] font-display font-bold uppercase tracking-wider opacity-40">Claude</p>
              <div className="border-l-2 border-carbon dark:border-white/70 pl-4 text-sm text-carbon leading-relaxed">
                <Markdown text={turn.reply.text} />
                {turn.reply.truncated && (
                  <p className="mt-2 text-[11px] font-mono opacity-40">Reply shortened to the capture limit.</p>
                )}
              </div>
            </div>
          )}

          {!onlyRisky && turn.status === 'interrupted' && (
            <p className="text-center text-[11px] font-mono uppercase tracking-wider opacity-30">— interrupted —</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── View ────────────────────────────────────────────────────────────────────

interface ConversationViewProps {
  sessionId: string;
  onShowAlerts: () => void;
}

export function ConversationView({ sessionId, onShowAlerts }: ConversationViewProps) {
  const { data, isLoading, error } = useSessionConversation(sessionId);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [onlyRisky, setOnlyRisky] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const alertCursor = useRef(-1);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live: refetch shortly after this session's events stop arriving.
  const onLiveEvent = useCallback(
    (event: Event) => {
      if (event.session_id !== sessionId) return;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions.conversation(sessionId) });
      }, LIVE_REFRESH_MS);
    },
    [queryClient, sessionId]
  );
  useWebSocketEvent(onLiveEvent);
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  // Newest turn first; steps inside a turn stay in the order they happened.
  const turns = useMemo(() => [...(data?.turns ?? [])].reverse(), [data]);

  // Open the latest turn (and any still running) on first load.
  useEffect(() => {
    if (initialized || turns.length === 0) return;
    const open = new Set<number>([turns[0].index]);
    turns.filter((t) => t.status === 'in_progress').forEach((t) => open.add(t.index));
    setExpanded(open);
    setInitialized(true);
  }, [turns, initialized]);

  const visible = useMemo(() => {
    let list = turns;
    if (onlyRisky) list = list.filter(turnIsRisky);
    if (query.trim()) list = list.filter((t) => turnMatches(t, query.trim()));
    return list;
  }, [turns, onlyRisky, query]);

  // Top-level risky steps in display order, for "next alert".
  const riskyTargets = useMemo(
    () =>
      turns.flatMap((turn) =>
        turn.items.flatMap((item, i) =>
          isStep(item) && isRisky(item) ? [{ turn: turn.index, domId: `step-${turn.index}-${i}` }] : []
        )
      ),
    [turns]
  );

  const jumpToNextAlert = () => {
    if (riskyTargets.length === 0) return;
    alertCursor.current = (alertCursor.current + 1) % riskyTargets.length;
    const target = riskyTargets[alertCursor.current];
    setExpanded((prev) => new Set(prev).add(target.turn));
    setHighlighted(target.domId);
  };

  useEffect(() => {
    if (!highlighted) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(highlighted)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const clear = setTimeout(() => setHighlighted(null), 2000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(clear);
    };
  }, [highlighted]);

  // The trajectory as the API returns it: turns oldest first.
  const handleExport = () => {
    if (!data) return;
    const exported = { exported_at: new Date().toISOString(), ...data };
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentsleak-conversation-${sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggle = (index: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 opacity-40">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return <div className="card-sm p-6 text-sm text-alert-red">Couldn't load the conversation for this session.</div>;
  }

  const searching = query.trim().length > 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[14rem] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-40" />
          <input
            id="conversation-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search prompts, notes, replies, commands"
            className="input-search w-full pl-9"
          />
        </div>
        <button
          type="button"
          onClick={() => setOnlyRisky((v) => !v)}
          aria-pressed={onlyRisky}
          className={cn('btn btn-press inline-flex items-center gap-1.5', onlyRisky ? 'btn-primary' : 'btn-secondary')}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          Security only
        </button>
        <button
          type="button"
          onClick={jumpToNextAlert}
          disabled={riskyTargets.length === 0}
          className="btn btn-secondary btn-press disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next alert{riskyTargets.length > 0 ? ` (${riskyTargets.length})` : ''}
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={turns.length === 0}
          className="btn btn-secondary btn-press inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" />
          Export
        </button>
        <div className="flex items-center gap-1 text-xs">
          <button type="button" className="btn-ghost px-2 py-1" onClick={() => setExpanded(new Set(turns.map((t) => t.index)))}>
            Expand all
          </button>
          <span className="opacity-20">/</span>
          <button type="button" className="btn-ghost px-2 py-1" onClick={() => setExpanded(new Set())}>
            Collapse all
          </button>
        </div>
      </div>

      <p className="text-xs font-mono opacity-40">
        {data.totals.turns} prompt{data.totals.turns === 1 ? '' : 's'} · {data.totals.steps} tool calls ·{' '}
        {data.totals.blocked} blocked · {data.totals.alerts} alerts
      </p>

      {!data.replies_captured && turns.length > 0 && (
        <div className="card-sm px-4 py-3 flex gap-3 text-sm text-carbon/70">
          <Info className="w-4 h-4 mt-0.5 shrink-0 opacity-50" />
          <p>
            Claude's replies and notes weren't recorded for this session. Reinstall the hooks
            (<code className="font-mono text-xs">hooks/install.sh</code>) to capture them in new sessions.
          </p>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="card-sm p-10 text-center text-sm opacity-50">
          {turns.length === 0
            ? 'No prompts recorded for this session yet.'
            : onlyRisky
              ? 'No blocked calls or alerts in this session.'
              : 'No turns match your search.'}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((turn) => (
            <TurnCard
              key={turn.index}
              turn={turn}
              expanded={searching || onlyRisky || expanded.has(turn.index)}
              onToggle={() => toggle(turn.index)}
              onlyRisky={onlyRisky}
              highlightedStep={highlighted}
              onShowAlerts={onShowAlerts}
            />
          ))}
        </div>
      )}
    </div>
  );
}
