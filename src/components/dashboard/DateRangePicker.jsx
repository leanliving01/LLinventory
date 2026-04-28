import React from 'react';
import { Input } from '@/components/ui/input';
import { Calendar } from 'lucide-react';
import { format, subDays, startOfDay, startOfMonth } from 'date-fns';
import { cn } from '@/lib/utils';

const PRESETS = [
  { label: 'Today', key: 'today' },
  { label: '7 Days', key: '7d' },
  { label: '30 Days', key: '30d' },
  { label: 'This Month', key: 'month' },
  { label: 'Custom', key: 'custom' },
];

export default function DateRangePicker({ from, to, onChange }) {
  const [active, setActive] = React.useState('30d');
  const [showCustom, setShowCustom] = React.useState(false);

  const handlePreset = (key) => {
    setActive(key);
    const now = new Date();
    if (key === 'today') { onChange(startOfDay(now), now); setShowCustom(false); }
    else if (key === '7d') { onChange(subDays(now, 7), now); setShowCustom(false); }
    else if (key === '30d') { onChange(subDays(now, 30), now); setShowCustom(false); }
    else if (key === 'month') { onChange(startOfMonth(now), now); setShowCustom(false); }
    else { setShowCustom(true); }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Calendar className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
      <div className="flex bg-muted rounded-md p-0.5">
        {PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => handlePreset(p.key)}
            className={cn(
              "text-xs px-3 py-1.5 rounded-sm font-medium transition-colors",
              active === p.key
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {showCustom && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={format(from, 'yyyy-MM-dd')}
            onChange={e => onChange(new Date(e.target.value), to)}
            className="h-8 w-36 text-xs"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={format(to, 'yyyy-MM-dd')}
            onChange={e => onChange(from, new Date(e.target.value))}
            className="h-8 w-36 text-xs"
          />
        </div>
      )}
      <span className="text-[11px] text-muted-foreground ml-1 tabular-nums">
        {format(from, 'dd MMM')} — {format(to, 'dd MMM yyyy')}
      </span>
    </div>
  );
}