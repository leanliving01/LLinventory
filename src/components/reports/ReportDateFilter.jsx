import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Calendar, Printer, Download } from 'lucide-react';
import { format, subDays, startOfMonth } from 'date-fns';

const PRESETS = [
  { label: '7d', key: '7d' },
  { label: '30d', key: '30d' },
  { label: 'MTD', key: 'mtd' },
  { label: 'Custom', key: 'custom' },
];

export default function ReportDateFilter({ from, to, onChange, onExportCSV, onPrint, csvLabel }) {
  const [active, setActive] = useState('30d');
  const [showCustom, setShowCustom] = useState(false);

  const handlePreset = (key) => {
    setActive(key);
    const now = new Date();
    if (key === '7d') { onChange(subDays(now, 7), now); setShowCustom(false); }
    else if (key === '30d') { onChange(subDays(now, 30), now); setShowCustom(false); }
    else if (key === 'mtd') { onChange(startOfMonth(now), now); setShowCustom(false); }
    else { setShowCustom(true); }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex bg-muted rounded-lg p-0.5">
        {PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => handlePreset(p.key)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              active === p.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {showCustom && (
        <div className="flex items-center gap-1.5">
          <Input type="date" value={format(from, 'yyyy-MM-dd')} onChange={e => onChange(new Date(e.target.value), to)} className="h-8 w-36 text-xs" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={format(to, 'yyyy-MM-dd')} onChange={e => onChange(from, new Date(e.target.value))} className="h-8 w-36 text-xs" />
        </div>
      )}
      <span className="text-[10px] text-muted-foreground">
        {format(from, 'dd MMM')} — {format(to, 'dd MMM yyyy')}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        {onExportCSV && (
          <Button variant="outline" size="sm" onClick={onExportCSV} className="gap-1.5 text-xs h-8">
            <Download className="w-3.5 h-3.5" /> {csvLabel || 'CSV'}
          </Button>
        )}
        {onPrint && (
          <Button variant="outline" size="sm" onClick={onPrint} className="gap-1.5 text-xs h-8">
            <Printer className="w-3.5 h-3.5" /> Print
          </Button>
        )}
      </div>
    </div>
  );
}