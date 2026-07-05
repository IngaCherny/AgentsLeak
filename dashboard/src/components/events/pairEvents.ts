import type { Event } from '@/api/types';

export type PairState = 'done' | 'failed' | 'blocked' | 'pending';

/**
 * One tool invocation, possibly with both Pre and Post (or Failure) sides seen.
 *
 * - `pre`     PreToolUse event (intent). Always present — pairs always anchor on the Pre.
 * - `post`    PostToolUse OR PostToolUseFailure event (result). Absent when blocked or in-flight.
 * - `state`   done | failed | blocked | pending — see resolveState() for the rules.
 * - `key`     stable string used as React key.
 */
export interface EventPair {
  key: string;
  pre: Event;
  post: Event | null;
  state: PairState;
  /**
   * Most-severe of the matched events. The paired card shows one severity,
   * so we promote to the higher of pre/post.
   */
  severity: string;
  /**
   * Earliest timestamp in the pair (the Pre's timestamp). Used for ordering.
   */
  firstTime: string;
  /**
   * Latest timestamp in the pair (Post's if present, else Pre's). Used for
   * "X seconds ago" displays.
   */
  lastTime: string;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function maxSeverity(a: string, b: string): string {
  return (SEVERITY_RANK[a] ?? 0) >= (SEVERITY_RANK[b] ?? 0) ? a : b;
}

function resolveState(pre: Event, post: Event | null): PairState {
  if (pre.blocked) return 'blocked';
  if (post === null) return 'pending';
  if (post.hook_type === 'PostToolUseFailure') return 'failed';
  // Some agents (Claude Code) fire PostToolUse for both success and failure;
  // surface error info from the payload when present.
  const result = post.tool_result as Record<string, unknown> | undefined | null;
  if (result && (result.is_error === true || result.error)) return 'failed';
  return 'done';
}

/**
 * Heuristic pairing window for events that lack a tool_use_id (older rows,
 * Cursor sessions before the field was plumbed, custom agents). Two events
 * are considered the same call if their timestamps are within this many ms.
 */
const HEURISTIC_WINDOW_MS = 5_000;

/**
 * Group a flat list of events into EventPair[].
 *
 * Strategy:
 *   1. Join by (session_id, tool_use_id) when tool_use_id is set on both sides.
 *      This is exact — Claude Code guarantees the same ID across Pre/Post/Failure.
 *   2. For events with no tool_use_id, fall back to (session_id, tool_name) +
 *      timestamp proximity. The first unmatched Pre within the window claims
 *      the Post.
 *   3. Non-tool events (SessionStart, UserPromptSubmit, PreCompact, etc.) are
 *      passed through as solo "pre" rows with state=done — they aren't really
 *      pairs but we keep them in the feed so users don't lose visibility.
 *
 * Input is expected newest-first (the order the API returns); output preserves
 * that ordering by the Pre's timestamp.
 */
export function pairEvents(events: Event[]): EventPair[] {
  // Split into tool events (paired) and lifecycle events (passed through).
  const isToolEvent = (e: Event) =>
    e.hook_type === 'PreToolUse' ||
    e.hook_type === 'PostToolUse' ||
    e.hook_type === 'PostToolUseFailure';

  const pres: Event[] = [];
  const posts: Event[] = [];
  const solo: Event[] = [];

  for (const e of events) {
    if (!isToolEvent(e)) {
      solo.push(e);
      continue;
    }
    if (e.hook_type === 'PreToolUse') pres.push(e);
    else posts.push(e);
  }

  // Index posts by (session, tool_use_id) for the exact-match path.
  const postsByTuid = new Map<string, Event>();
  // …and by (session, tool_name) sorted by timestamp for the heuristic path.
  const postsByName = new Map<string, Event[]>();
  for (const p of posts) {
    if (p.tool_use_id) {
      postsByTuid.set(`${p.session_id}::${p.tool_use_id}`, p);
    } else if (p.tool_name) {
      const key = `${p.session_id}::${p.tool_name}`;
      const arr = postsByName.get(key) ?? [];
      arr.push(p);
      postsByName.set(key, arr);
    }
  }
  for (const arr of postsByName.values()) {
    arr.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  const claimed = new Set<string>(); // event ids of posts already paired

  const pairs: EventPair[] = [];

  for (const pre of pres) {
    let post: Event | null = null;

    // 1) Exact match via tool_use_id.
    if (pre.tool_use_id) {
      const key = `${pre.session_id}::${pre.tool_use_id}`;
      const candidate = postsByTuid.get(key);
      if (candidate && !claimed.has(candidate.id)) {
        post = candidate;
        claimed.add(candidate.id);
      }
    }

    // 2) Heuristic match: same session + tool_name + timestamp within window.
    if (post === null && pre.tool_name) {
      const key = `${pre.session_id}::${pre.tool_name}`;
      const candidates = postsByName.get(key) ?? [];
      const preMs = new Date(pre.timestamp).getTime();
      for (const c of candidates) {
        if (claimed.has(c.id)) continue;
        const cMs = new Date(c.timestamp).getTime();
        if (cMs >= preMs && cMs - preMs <= HEURISTIC_WINDOW_MS) {
          post = c;
          claimed.add(c.id);
          break;
        }
      }
    }

    const state = resolveState(pre, post);
    pairs.push({
      key: `pre-${pre.id}`,
      pre,
      post,
      state,
      severity: post
        ? maxSeverity(pre.severity, post.severity)
        : pre.severity,
      firstTime: pre.timestamp,
      lastTime: post ? post.timestamp : pre.timestamp,
    });
  }

  // Orphan posts (matched no Pre) — rare, but surface them so we don't drop data.
  for (const p of posts) {
    if (claimed.has(p.id)) continue;
    pairs.push({
      key: `orphan-${p.id}`,
      pre: p, // treat the orphan post as its own anchor
      post: null,
      state:
        p.hook_type === 'PostToolUseFailure'
          ? 'failed'
          : ((p.tool_result as Record<string, unknown> | null)?.is_error === true
              ? 'failed'
              : 'done'),
      severity: p.severity,
      firstTime: p.timestamp,
      lastTime: p.timestamp,
    });
  }

  // Solo lifecycle events.
  for (const e of solo) {
    pairs.push({
      key: `solo-${e.id}`,
      pre: e,
      post: null,
      state: 'done',
      severity: e.severity,
      firstTime: e.timestamp,
      lastTime: e.timestamp,
    });
  }

  // Sort newest-first by Pre timestamp.
  pairs.sort((a, b) => b.firstTime.localeCompare(a.firstTime));
  return pairs;
}
