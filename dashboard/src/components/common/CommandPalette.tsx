import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  LayoutDashboard,
  Radio,
  Layers,
  AlertTriangle,
  Shield,
  GitBranch,
  BarChart3,
  CornerDownLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSessions, useAlerts, usePolicies } from '@/api/queries';

interface CommandItem {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: React.ElementType;
  run: () => void;
}

const PAGES: { label: string; to: string; icon: React.ElementType }[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Live Feed', to: '/live', icon: Radio },
  { label: 'Sessions', to: '/sessions', icon: Layers },
  { label: 'Alerts', to: '/alerts', icon: AlertTriangle },
  { label: 'Policies', to: '/policies', icon: Shield },
  { label: 'Graph', to: '/graph', icon: GitBranch },
  { label: 'Analytics', to: '/analytics', icon: BarChart3 },
];

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // These queries only fire while the palette is mounted (i.e. open).
  const { data: sessionsData } = useSessions(undefined, 1, 30);
  const { data: alertsData } = useAlerts(undefined, 1, 30);
  const { data: policies } = usePolicies();

  const go = useCallback(
    (to: string) => {
      navigate(to);
      onClose();
    },
    [navigate, onClose],
  );

  const items = useMemo<CommandItem[]>(() => {
    const out: CommandItem[] = [];

    for (const p of PAGES) {
      out.push({
        id: `page:${p.to}`,
        group: 'Pages',
        label: p.label,
        icon: p.icon,
        run: () => go(p.to),
      });
    }

    for (const s of sessionsData?.items ?? []) {
      const name = s.cwd?.split('/').pop() || s.session_id.slice(0, 12);
      out.push({
        id: `session:${s.session_id}`,
        group: 'Sessions',
        label: name,
        sub: `${s.session_id.slice(0, 12)} · ${s.status}`,
        icon: Layers,
        run: () => go(`/sessions/${s.session_id}`),
      });
    }

    for (const a of alertsData?.items ?? []) {
      out.push({
        id: `alert:${a.id}`,
        group: 'Alerts',
        label: a.title,
        sub: `${a.severity} · ${a.policy_name || a.category}`,
        icon: AlertTriangle,
        run: () => go(`/alerts?id=${a.id}`),
      });
    }

    for (const p of policies ?? []) {
      out.push({
        id: `policy:${p.id}`,
        group: 'Policies',
        label: p.name,
        sub: `${p.action} rule`,
        icon: Shield,
        run: () => go('/policies'),
      });
    }

    return out;
  }, [sessionsData, alertsData, policies, go]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Empty query: pages + a handful of the most recent records.
      return items.filter(
        (i) => i.group === 'Pages' || items.indexOf(i) < PAGES.length + 6,
      );
    }
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        (i.sub?.toLowerCase().includes(q) ?? false),
    );
  }, [items, query]);

  // Reset highlight whenever the result set changes.
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(filtered.length - 1, a + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        filtered[active]?.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, active, onClose]);

  // Render grouped, but track a flat index for keyboard nav.
  let flatIdx = -1;
  const groups = ['Pages', 'Sessions', 'Alerts', 'Policies'].filter((g) =>
    filtered.some((i) => i.group === g),
  );

  return (
    <div
      data-command-palette
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] px-4 bg-carbon/30 dark:bg-black/65 backdrop-blur-[2px] animate-fade-in"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-xl card overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 border-b border-carbon/10">
          <Search className="w-4 h-4 text-carbon/40 dark:text-white/40 flex-shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions, alerts, policies, pages…"
            className="flex-1 bg-transparent py-3.5 text-sm text-carbon dark:text-white placeholder-carbon/35 dark:placeholder-white/30 outline-none font-mono"
          />
          <kbd className="text-[10px] font-mono font-bold text-carbon/40 dark:text-white/35 border border-carbon/15 dark:border-white/15 rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs font-mono text-carbon/40 dark:text-white/35">
              No matches for “{query}”
            </p>
          ) : (
            groups.map((group) => (
              <div key={group} className="mb-1 last:mb-0">
                <p className="px-4 pt-2 pb-1 text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-carbon/35 dark:text-white/30">
                  {group}
                </p>
                {filtered
                  .filter((i) => i.group === group)
                  .map((item) => {
                    flatIdx += 1;
                    const idx = flatIdx;
                    const isActive = idx === active;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        data-idx={idx}
                        onMouseMove={() => setActive(idx)}
                        onClick={item.run}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                          isActive
                            ? 'bg-alert-red/[0.07] dark:bg-alert-red/[0.12]'
                            : 'hover:bg-carbon/[0.03] dark:hover:bg-white/[0.04]',
                        )}
                      >
                        <Icon
                          className={cn(
                            'w-4 h-4 flex-shrink-0',
                            isActive
                              ? 'text-alert-red'
                              : 'text-carbon/40 dark:text-white/40',
                          )}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-carbon dark:text-white truncate">
                            {item.label}
                          </span>
                          {item.sub && (
                            <span className="block text-[11px] font-mono text-carbon/45 dark:text-white/40 truncate">
                              {item.sub}
                            </span>
                          )}
                        </span>
                        {isActive && (
                          <CornerDownLeft className="w-3.5 h-3.5 text-alert-red flex-shrink-0" />
                        )}
                      </button>
                    );
                  })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-carbon/10 text-[10px] font-mono text-carbon/40 dark:text-white/35">
          <span className="flex items-center gap-1">
            <kbd className="border border-carbon/15 dark:border-white/15 rounded px-1">↑</kbd>
            <kbd className="border border-carbon/15 dark:border-white/15 rounded px-1">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="border border-carbon/15 dark:border-white/15 rounded px-1">↵</kbd>
            open
          </span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
