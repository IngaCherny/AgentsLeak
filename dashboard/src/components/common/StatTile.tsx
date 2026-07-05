import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatTileProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  /** When set, the tile becomes a clickable link with a hover lift. */
  to?: string;
  isLoading?: boolean;
  /** Render the value in alert-red (used for critical / blocked metrics). */
  accent?: boolean;
  sub?: React.ReactNode;
}

/**
 * Shared metric tile — the canonical dashboard card.
 * Mono uppercase label on top, large display number below.
 * Matches the Dashboard MetricTile so every page reads as one tool.
 */
export function StatTile({ title, value, icon: Icon, to, isLoading, accent, sub }: StatTileProps) {
  const body = (
    <>
      {to && (
        <ArrowUpRight className="absolute top-3.5 right-3.5 w-4 h-4 text-carbon/20 dark:text-white/20 group-hover:text-alert-red transition-colors" />
      )}
      <div className="flex items-center gap-2 text-carbon/45 dark:text-white/40">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider">{title}</span>
      </div>
      {isLoading ? (
        <div className="h-8 w-20 bg-carbon/10 rounded mt-2.5 animate-pulse" />
      ) : (
        <p
          className={cn(
            'text-[32px] leading-none font-display font-bold mt-2.5 tabular-nums',
            accent ? 'text-alert-red' : 'text-carbon dark:text-white',
          )}
        >
          {value}
        </p>
      )}
      {sub && (
        <p className="text-[11px] font-mono mt-2 text-carbon/50 dark:text-white/40">{sub}</p>
      )}
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="card p-4 block group relative transition-transform duration-200 hover:-translate-y-1 active:translate-y-0"
      >
        {body}
      </Link>
    );
  }

  return <div className="card p-4 relative">{body}</div>;
}

export default StatTile;
