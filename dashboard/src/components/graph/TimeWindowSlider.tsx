import { useState, useCallback, useRef, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimeWindowSliderProps {
  min: string; // ISO date string
  max: string; // ISO date string
  onChange: (from: string | undefined, to: string | undefined) => void;
  defaultPreset?: string; // e.g. '5m', '15m', '1h', 'All'
}

const PRESETS = [
  { label: '5m', ms: 5 * 60 * 1000 },
  { label: '15m', ms: 15 * 60 * 1000 },
  { label: '1h', ms: 60 * 60 * 1000 },
  { label: 'All', ms: 0 },
];

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function TimeWindowSlider({ min, max, onChange, defaultPreset = 'All' }: TimeWindowSliderProps) {
  const minMs = new Date(min).getTime();
  const maxMs = new Date(max).getTime();
  const rangeMs = maxMs - minMs;

  // Compute initial fromPct based on defaultPreset
  const initFromPct = (() => {
    if (defaultPreset === 'All' || rangeMs <= 0) return 0;
    const preset = PRESETS.find(p => p.label === defaultPreset);
    if (!preset || preset.ms === 0) return 0;
    const fromMs = Math.max(maxMs - preset.ms, minMs);
    return ((fromMs - minMs) / rangeMs) * 100;
  })();

  const [fromPct, setFromPct] = useState(initFromPct);
  const [toPct, setToPct] = useState(100);
  const [activePreset, setActivePreset] = useState(defaultPreset);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const pctToDate = useCallback(
    (pct: number) => new Date(minMs + (rangeMs * pct) / 100).toISOString(),
    [minMs, rangeMs],
  );

  const emitChange = useCallback(
    (from: number, to: number) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const isAll = from <= 0 && to >= 100;
        onChange(isAll ? undefined : pctToDate(from), isAll ? undefined : pctToDate(to));
      }, 300);
    },
    [onChange, pctToDate],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handlePreset = (label: string, ms: number) => {
    setActivePreset(label);
    if (ms === 0) {
      setFromPct(0);
      setToPct(100);
      emitChange(0, 100);
    } else {
      const fromMs = Math.max(maxMs - ms, minMs);
      const pct = ((fromMs - minMs) / rangeMs) * 100;
      setFromPct(pct);
      setToPct(100);
      emitChange(pct, 100);
    }
  };

  const handleFromChange = (val: number) => {
    const clamped = Math.min(val, toPct - 1);
    setFromPct(clamped);
    setActivePreset('');
    emitChange(clamped, toPct);
  };

  const handleToChange = (val: number) => {
    const clamped = Math.max(val, fromPct + 1);
    setToPct(clamped);
    setActivePreset('');
    emitChange(fromPct, clamped);
  };

  if (rangeMs <= 0) return null;

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-carbon/[0.06] bg-carbon/[0.02]">
      <Clock className="w-3.5 h-3.5 opacity-30 flex-shrink-0" />

      <div className="flex items-center gap-1 flex-shrink-0">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => handlePreset(p.label, p.ms)}
            className={cn(
              'px-2 py-0.5 text-[10px] font-mono font-bold transition-colors',
              activePreset === p.label
                ? 'bg-carbon text-white'
                : 'text-carbon/40 hover:text-alert-red',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex-1 relative h-5 flex items-center">
        {/* Track */}
        <div className="absolute inset-x-0 h-1 rounded-full bg-carbon/10" />
        {/* Selected range */}
        <div
          className="absolute h-1 rounded-full bg-carbon/40"
          style={{ left: `${fromPct}%`, width: `${toPct - fromPct}%` }}
        />
        {/* From handle */}
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={fromPct}
          onChange={(e) => handleFromChange(Number(e.target.value))}
          className="absolute inset-x-0 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-carbon [&::-webkit-slider-thumb]:cursor-grab"
          style={{ zIndex: 3 }}
        />
        {/* To handle */}
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={toPct}
          onChange={(e) => handleToChange(Number(e.target.value))}
          className="absolute inset-x-0 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-alert-red [&::-webkit-slider-thumb]:cursor-grab"
          style={{ zIndex: 4 }}
        />
      </div>

      <span className="text-[10px] font-mono opacity-40 flex-shrink-0 min-w-[140px] text-right">
        {formatTime(pctToDate(fromPct))} — {formatTime(pctToDate(toPct))}
      </span>
    </div>
  );
}
