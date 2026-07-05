import { useLocation, Link } from 'react-router-dom';
import { Search, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useStats } from '@/api/queries';

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/live': 'Live Feed',
  '/sessions': 'Sessions',
  '/alerts': 'Alerts',
  '/policies': 'Policies',
  '/graph': 'Graph',
  '/analytics': 'Analytics',
};

function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith('/sessions/')) return 'Session Detail';
  return 'AgentsLeak';
}

export function TopBar({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const { pathname } = useLocation();
  const title = titleFor(pathname);
  const { isConnected } = useWebSocket();
  const { data: stats } = useStats();
  const newAlerts = stats?.new_alerts ?? 0;

  return (
    <header className="h-14 flex-shrink-0 flex items-center gap-3 px-6 bg-white dark:bg-[#0C0C0C] relative z-20">
      {/* Page title */}
      <h1 className="font-display font-bold text-lg text-carbon dark:text-white whitespace-nowrap">
        {title}
      </h1>

      {/* Global search — opens the command palette */}
      <button
        onClick={onOpenSearch}
        className="flex items-center gap-2 ml-3 flex-1 max-w-sm text-carbon/45 dark:text-white/40 bg-carbon/[0.03] dark:bg-white/[0.04] border border-carbon/10 rounded-lg px-3 py-1.5 hover:border-carbon/20 dark:hover:border-white/20 hover:text-carbon/60 dark:hover:text-white/55 transition-colors"
      >
        <Search className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-xs font-mono truncate">Search sessions, alerts, files…</span>
        <span className="ml-auto text-[10px] font-mono border border-carbon/15 dark:border-white/15 rounded px-1.5 py-0.5">⌘K</span>
      </button>

      <div className="flex-1" />

      {/* Connection indicator — reflects the live WebSocket */}
      <div
        title={isConnected ? 'Live connection active' : 'Disconnected'}
        className={cn(
          'flex items-center gap-2 text-[10px] font-mono font-bold tracking-wide border rounded-lg px-2.5 py-[7px]',
          isConnected
            ? 'text-carbon/55 dark:text-white/55 border-carbon/10'
            : 'text-carbon/35 dark:text-white/30 border-carbon/10',
        )}
      >
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full',
            isConnected
              ? 'bg-carbon dark:bg-white animate-pulse-slow'
              : 'bg-carbon/30 dark:bg-white/25',
          )}
        />
        {isConnected ? 'LIVE' : 'OFFLINE'}
      </div>

      {/* Alerts — with unresolved count badge */}
      <Link
        to="/alerts"
        title={newAlerts > 0 ? `${newAlerts} new alerts` : 'Alerts'}
        className="relative p-2 rounded-lg text-carbon/55 dark:text-white/55 hover:text-alert-red dark:hover:text-alert-red hover:bg-carbon/[0.04] dark:hover:bg-white/[0.05] transition-colors"
      >
        <Bell className="w-4 h-4" />
        {newAlerts > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[15px] h-[15px] px-1 flex items-center justify-center text-[10px] font-mono font-bold text-white bg-alert-red rounded-full ring-2 ring-white dark:ring-[#0C0C0C]">
            {newAlerts > 99 ? '99+' : newAlerts}
          </span>
        )}
      </Link>
    </header>
  );
}

export default TopBar;
