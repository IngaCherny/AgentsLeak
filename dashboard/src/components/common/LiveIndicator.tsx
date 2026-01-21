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
          ? 'bg-green-50 text-green-700 border-green-600'
          : reconnecting
            ? 'bg-yellow-50 text-yellow-700 border-yellow-600'
            : 'bg-white text-carbon border-carbon',
        className
      )}
    >
      <span className="relative flex h-2 w-2">
        {(connected || reconnecting) && (
          <span
            className={cn(
              'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
              connected ? 'bg-green-500' : 'bg-yellow-500'
            )}
          />
        )}
        <span
          className={cn(
            'relative inline-flex h-2 w-2 rounded-full',
            connected
              ? 'bg-green-500'
              : reconnecting
                ? 'bg-yellow-500'
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
