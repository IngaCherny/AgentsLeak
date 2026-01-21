import { cn } from '@/lib/utils';
import { Severity } from '@/api/types';

interface SeverityBadgeProps {
  severity: Severity;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const severityBadgeClass: Record<Severity, string> = {
  [Severity.Critical]: 'badge-critical',
  [Severity.High]: 'badge-high',
  [Severity.Medium]: 'badge-medium',
  [Severity.Low]: 'badge-low',
  [Severity.Info]: 'badge-info',
};

const severityLabel: Record<Severity, string> = {
  [Severity.Critical]: 'Critical',
  [Severity.High]: 'High',
  [Severity.Medium]: 'Medium',
  [Severity.Low]: 'Low',
  [Severity.Info]: 'Info',
};

const sizeStyles = {
  sm: 'px-2 py-0.5 text-[11px]',
  md: '',
  lg: 'px-3 py-1 text-sm',
};

export function SeverityBadge({
  severity,
  size = 'md',
  className,
}: SeverityBadgeProps) {
  return (
    <span
      className={cn(
        'badge',
        severityBadgeClass[severity],
        sizeStyles[size],
        className
      )}
    >
      {severityLabel[severity]}
    </span>
  );
}

interface SeverityDotProps {
  severity: Severity;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  pulse?: boolean;
}

const dotSizes = {
  sm: 'w-1.5 h-1.5',
  md: 'w-2.5 h-2.5',
  lg: 'w-3 h-3',
};

export function SeverityDot({
  severity,
  size = 'md',
  className,
  pulse = false,
}: SeverityDotProps) {
  const colorMap: Record<Severity, string> = {
    [Severity.Critical]: 'bg-severity-critical',
    [Severity.High]: 'bg-severity-high',
    [Severity.Medium]: 'bg-severity-medium',
    [Severity.Low]: 'bg-severity-low',
    [Severity.Info]: 'bg-severity-info',
  };

  return (
    <span
      className={cn(
        'inline-block rounded-full',
        colorMap[severity],
        dotSizes[size],
        pulse && 'animate-pulse',
        className
      )}
    />
  );
}

export default SeverityBadge;
