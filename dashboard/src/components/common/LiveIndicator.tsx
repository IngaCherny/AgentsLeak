import { cn } from '@/lib/utils';

interface LiveIndicatorProps {
  connected: boolean;
  className?: string;
  showLabel?: boolean;
}

export function LiveIndicator({
  connected,
  className,
  showLabel = true,
}: LiveIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="relative flex h-2.5 w-2.5">
        {connected && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-carbon opacity-75" />
        )}
        <span
          className={cn(
            'relative inline-flex h-2.5 w-2.5 rounded-full',
            connected ? 'bg-carbon' : 'bg-carbon/20'
          )}
        />
      </span>
      {showLabel && (
        <span
          className={cn(
            'text-xs font-mono',
            connected ? 'text-carbon' : 'opacity-40'
          )}
        >
          {connected ? 'LIVE' : 'OFFLINE'}
        </span>
      )}
    </div>
  );
}

interface ConnectionStatusProps {
  connected: boolean;
  reconnecting?: boolean;
  className?: string;
}

export function ConnectionStatus({
  connected,
  reconnecting,
  className,
}: ConnectionStatusProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded-full border',
        connected
          ? 'bg-carbon/[0.05] dark:bg-white/[0.06] text-carbon border-carbon/30'
          : reconnecting
            ? 'bg-alert-red/[0.08] text-alert-red border-alert-red/40'
            : 'bg-white text-carbon border-carbon',
        className
      )}
    >
      <span className="relative flex h-2 w-2">
        {(connected || reconnecting) && (
          <span
            className={cn(
              'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
              connected ? 'bg-carbon dark:bg-white' : 'bg-alert-red'
            )}
          />
        )}
        <span
          className={cn(
            'relative inline-flex h-2 w-2 rounded-full',
            connected
              ? 'bg-carbon dark:bg-white'
              : reconnecting
                ? 'bg-alert-red'
                : 'bg-carbon'
          )}
        />
      </span>
      <span>
        {connected
          ? 'CONNECTED'
          : reconnecting
            ? 'RECONNECTING...'
            : 'DISCONNECTED'}
      </span>
    </div>
  );
}

export default LiveIndicator;
