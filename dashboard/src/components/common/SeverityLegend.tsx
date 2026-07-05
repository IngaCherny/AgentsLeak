import { cn } from '@/lib/utils';

const LEVELS: { label: string; color: string }[] = [
  { label: 'Critical', color: '#D90429' },
  { label: 'High', color: '#C4516C' },
  { label: 'Medium', color: '#8B8B8B' },
  { label: 'Low', color: '#C8C8C8' },
];

/**
 * Compact legend for the severity ladder — the swatch echoes the
 * 3px row accent so the coding reads the same everywhere.
 */
export function SeverityLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3.5', className)}>
      {LEVELS.map((s) => (
        <span
          key={s.label}
          className="flex items-center gap-1.5 text-[10px] font-mono font-medium uppercase tracking-wider text-carbon/50 dark:text-white/45"
        >
          <span
            className="w-3 h-[3px] rounded-full"
            style={{ background: s.color }}
          />
          {s.label}
        </span>
      ))}
    </div>
  );
}

export default SeverityLegend;
