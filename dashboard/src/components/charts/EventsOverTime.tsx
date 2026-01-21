import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import type { TimelineResponse } from '@/api/types';
import { useDarkMode } from '@/lib/useDarkMode';

interface EventsOverTimeProps {
  data: TimelineResponse | undefined;
  isLoading: boolean;
  interval: 'minute' | 'hour' | 'day';
}

function formatTimestamp(ts: string, interval: 'minute' | 'hour' | 'day'): string {
  const d = new Date(ts);
  switch (interval) {
    case 'minute':
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    case 'hour':
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    case 'day':
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

interface TooltipEntry {
  name: string;
  value: number;
  color: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  interval: 'minute' | 'hour' | 'day';
}

function CustomTooltip({ active, payload, label, interval }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;

  const ts = (payload[0] as TooltipEntry & { payload?: { timestamp?: string } })?.payload?.timestamp;
  const formatted = ts ? formatTimestamp(ts, interval) : label;

  return (
    <div className="bg-carbon text-white text-xs px-3 py-2 border border-carbon shadow-[3px_3px_0px_rgba(0,0,0,0.3)]">
      <p className="font-mono opacity-60 mb-1">{formatted}</p>
      {payload.map((entry: TooltipEntry) => (
        <p key={entry.name} className="flex items-center gap-2">
          <span
            className="w-2 h-2 inline-block rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="opacity-70">{entry.name}:</span>
          <span className="font-bold">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function EventsOverTime({ data, isLoading, interval }: EventsOverTimeProps) {
  const isDark = useDarkMode();
  const line = isDark ? '#ececec' : '#1A1A1A';
  const muted = isDark ? '#888888' : '#1A1A1A';
  const surface = isDark ? '#161616' : '#fff';

  const chartData = useMemo(() => {
    if (!data?.points?.length) return [];
    return data.points.map((p) => ({
      ...p,
      label: formatTimestamp(p.timestamp, interval),
    }));
  }, [data, interval]);

  const hasAlerts = useMemo(
    () => chartData.some((p) => p.alerts > 0),
    [chartData]
  );

  if (isLoading) {
    return (
      <div className="h-72 flex items-center justify-center">
        <Loader2 className="w-8 h-8 opacity-40 animate-spin" />
      </div>
    );
  }

  if (!chartData.length) {
    return (
      <div className="h-72 flex items-center justify-center border-dashed border">
        <p className="opacity-40">No timeline data available</p>
      </div>
    );
  }

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
        >
          <defs>
            <linearGradient id="eventsGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={line} stopOpacity={0.25} />
              <stop offset="100%" stopColor={line} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="alertsGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#D90429" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#D90429" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={muted}
            strokeOpacity={isDark ? 0.15 : 0.06}
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: muted, opacity: isDark ? 0.7 : 0.4, fontFamily: 'JetBrains Mono, monospace' }}
            tickLine={false}
            axisLine={{ stroke: muted, strokeOpacity: isDark ? 0.3 : 0.1 }}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            tick={{ fontSize: 10, fill: muted, opacity: isDark ? 0.7 : 0.4, fontFamily: 'JetBrains Mono, monospace' }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            content={<CustomTooltip interval={interval} />}
            cursor={{ stroke: muted, strokeOpacity: isDark ? 0.3 : 0.15, strokeWidth: 1 }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', opacity: isDark ? 0.7 : 0.5, color: isDark ? '#a0a0a0' : undefined }}
          />
          <Area
            type="monotone"
            dataKey="events"
            name="Events"
            stroke={line}
            strokeWidth={2}
            fill="url(#eventsGrad)"
            dot={false}
            activeDot={{ r: 4, fill: line, stroke: surface, strokeWidth: 2 }}
          />
          {hasAlerts && (
            <Area
              type="monotone"
              dataKey="alerts"
              name="Alerts"
              stroke="#D90429"
              strokeWidth={2}
              fill="url(#alertsGrad)"
              dot={(props: { key?: string; cx?: number; cy?: number; payload?: { alerts?: number } }) => {
                if (!props.payload?.alerts) return <g key={props.key} />;
                return (
                  <circle
                    key={props.key}
                    cx={props.cx}
                    cy={props.cy}
                    r={Math.min(3 + props.payload.alerts, 7)}
                    fill="#D90429"
                    stroke={surface}
                    strokeWidth={2}
                  />
                );
              }}
              activeDot={{ r: 6, fill: '#D90429', stroke: surface, strokeWidth: 2 }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
