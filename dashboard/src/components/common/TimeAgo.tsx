import { useEffect, useState } from 'react';
import {
  formatDistanceToNow,
  format,
  parseISO,
  differenceInSeconds,
} from 'date-fns';
import { cn } from '@/lib/utils';

interface TimeAgoProps {
  date: string | Date;
  className?: string;
  showTooltip?: boolean;
  live?: boolean;
  updateInterval?: number;
}

export function TimeAgo({
  date,
  className,
  showTooltip = true,
  live = true,
  updateInterval = 30000,
}: TimeAgoProps) {
  const [, setTick] = useState(0);

  const parsedDate = typeof date === 'string' ? parseISO(date) : date;

  useEffect(() => {
    if (!live) return;

    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, updateInterval);

    return () => clearInterval(interval);
  }, [live, updateInterval]);

  const timeAgo = formatDistanceToNow(parsedDate, { addSuffix: true });
  const fullDate = format(parsedDate, 'PPpp');

  return (
    <time
      dateTime={parsedDate.toISOString()}
      className={cn('opacity-40', className)}
      title={showTooltip ? fullDate : undefined}
    >
      {timeAgo}
    </time>
  );
}

interface RelativeTimeProps {
  date: string | Date;
  className?: string;
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  const [, setTick] = useState(0);

  const parsedDate = typeof date === 'string' ? parseISO(date) : date;
  const seconds = differenceInSeconds(new Date(), parsedDate);

  useEffect(() => {
    // Update more frequently for recent events
    const interval = seconds < 60 ? 1000 : seconds < 3600 ? 10000 : 60000;

    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, interval);

    return () => clearInterval(timer);
  }, [seconds]);

  const getRelativeTime = (): string => {
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <time
      dateTime={parsedDate.toISOString()}
      className={cn('opacity-40 tabular-nums', className)}
      title={format(parsedDate, 'PPpp')}
    >
      {getRelativeTime()}
    </time>
  );
}

interface TimestampProps {
  date: string | Date;
  className?: string;
  showDate?: boolean;
}

export function Timestamp({
  date,
  className,
  showDate = false,
}: TimestampProps) {
  const parsedDate = typeof date === 'string' ? parseISO(date) : date;

  const formatString = showDate ? 'MMM d, HH:mm:ss' : 'HH:mm:ss';

  return (
    <time
      dateTime={parsedDate.toISOString()}
      className={cn('opacity-40 font-mono text-sm', className)}
      title={format(parsedDate, 'PPpp')}
    >
      {format(parsedDate, formatString)}
    </time>
  );
}

export default TimeAgo;
