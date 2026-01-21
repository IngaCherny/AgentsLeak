import type { Event } from '@/api/types';

/** Aggregated group of events sharing the same target (file, command, URL). */
export interface AggregatedEvent {
  /** Key used for grouping */
  key: string;
  /** The representative first event */
  representative: Event;
  /** All events in this group */
  events: Event[];
  /** Total count */
  count: number;
  /** Earliest timestamp */
  firstTime: string;
  /** Latest timestamp */
  lastTime: string;
  /** Category of the group */
  category: string;
  /** Primary target text (file path, command, etc.) */
  target: string;
  /** Prefix for display (e.g., "$ " for commands) */
  prefix?: string;
}

function getEventSummary(event: Event): { text: string; prefix?: string } {
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

/** Group events by category + primary target. */
export function aggregateEvents(events: Event[]): AggregatedEvent[] {
  const groups: Map<string, AggregatedEvent> = new Map();
  const order: string[] = [];

  for (const e of events) {
    const summary = getEventSummary(e);
    const key = `${e.category}::${summary.text}`;

    const existing = groups.get(key);
    if (existing) {
      existing.events.push(e);
      existing.count++;
      if (e.timestamp < existing.firstTime) existing.firstTime = e.timestamp;
      if (e.timestamp > existing.lastTime) existing.lastTime = e.timestamp;
    } else {
      const group: AggregatedEvent = {
        key,
        representative: e,
        events: [e],
        count: 1,
        firstTime: e.timestamp,
        lastTime: e.timestamp,
        category: e.category,
        target: summary.text,
        prefix: summary.prefix,
      };
      groups.set(key, group);
      order.push(key);
    }
  }

  return order.map((k) => groups.get(k)!);
}
