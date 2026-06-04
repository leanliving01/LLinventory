import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { ClipboardCheck, MapPin, ChevronRight, ClipboardList } from 'lucide-react';
import { format } from 'date-fns';
import { COUNT_STATUS } from '@/lib/stockCount';
import FloorCountSession from '@/components/floor/FloorCountSession';

const STATUS_STYLES = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  recount_requested: 'bg-orange-100 text-orange-700',
  recount_in_progress: 'bg-orange-100 text-orange-700',
};

/**
 * Floor Stock Count — list of counts to work on. Floor staff capture quantities;
 * nothing posts to stock-on-hand here. Counts go to the web for review/posting.
 */
export default function FloorStockTake() {
  const [active, setActive] = useState(null); // selected count header

  const { data: counts = [], isLoading } = useQuery({
    queryKey: ['floor-stock-counts'],
    queryFn: () => base44.entities.NewStockTake.list('-created_date', 200),
    enabled: !active,
  });

  const planned = useMemo(
    () => counts.filter(c => ['open', 'in_progress'].includes(c.status)),
    [counts]
  );
  const recounts = useMemo(
    () => counts.filter(c => ['recount_requested', 'recount_in_progress'].includes(c.status)),
    [counts]
  );

  if (active) {
    return <FloorCountSession count={active} onBack={() => setActive(null)} />;
  }

  return (
    <div className="space-y-5 pb-24">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-green-600" /> Stock Count
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">Pick a count to capture quantities</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : (
        <>
          <CountSection title="Planned Counts" items={planned} onOpen={setActive} emptyText="No planned counts right now." />
          {recounts.length > 0 && (
            <CountSection title="Recount Requests" items={recounts} onOpen={setActive} emptyText="" />
          )}
        </>
      )}
    </div>
  );
}

function CountSection({ title, items, onOpen, emptyText }) {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
        <ClipboardList className="w-3.5 h-3.5" /> {title}
      </h2>
      {items.length === 0 ? (
        emptyText ? <p className="text-sm text-muted-foreground py-2">{emptyText}</p> : null
      ) : (
        <div className="space-y-2">
          {items.map(c => {
            const counted = (c.total_lines || 0) - (c.uncounted_count || 0);
            return (
              <button
                key={c.id}
                onClick={() => onOpen(c)}
                className="w-full text-left bg-card border border-border rounded-2xl px-4 py-3 flex items-center gap-3 active:bg-muted/50"
              >
                <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center shrink-0">
                  <ClipboardCheck className="w-5 h-5 text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-sm">{c.reference || c.id.slice(0, 8)}</span>
                    <Badge className={`text-[10px] ${STATUS_STYLES[c.status] || 'bg-gray-100 text-gray-600'}`}>
                      {COUNT_STATUS[c.status] || c.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3" /> {c.location_name || '—'}
                    {c.stocktake_date ? ` · ${format(new Date(c.stocktake_date), 'dd MMM')}` : ''}
                    {` · ${counted}/${c.total_lines || 0}`}
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
