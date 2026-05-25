import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar, ChevronDown, ChevronUp, ListChecks } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { cn } from '@/lib/utils';

/**
 * Multi-select production run picker with date range.
 * Allows PM to select which scheduled/in_progress production runs to include in WIP planning.
 *
 * Props:
 *   selectedRunIds: Set<string>
 *   onSelectionChange: (Set<string>) => void
 */
export default function RunSelector({ selectedRunIds, onSelectionChange }) {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [dateFrom, setDateFrom] = useState(todayStr);
  const [dateTo, setDateTo] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [expanded, setExpanded] = useState(true);

  const { data: allRuns = [], isLoading } = useQuery({
    queryKey: ['plannable-production-runs'],
    queryFn: async () => {
      const runs = await base44.entities.ProductionRun.list('-run_date', 200);
      return runs.filter(r => ['scheduled', 'in_progress', 'draft'].includes(r.status));
    },
  });

  const filteredRuns = useMemo(() => {
    return allRuns.filter(r => {
      if (!r.run_date) return false;
      return r.run_date >= dateFrom && r.run_date <= dateTo;
    }).sort((a, b) => (a.run_date || '').localeCompare(b.run_date || '') || (a.run_number || '').localeCompare(b.run_number || ''));
  }, [allRuns, dateFrom, dateTo]);

  const toggleRun = (runId) => {
    const next = new Set(selectedRunIds);
    if (next.has(runId)) next.delete(runId);
    else next.add(runId);
    onSelectionChange(next);
  };

  const selectAll = () => {
    onSelectionChange(new Set(filteredRuns.map(r => r.id)));
  };

  const clearAll = () => {
    onSelectionChange(new Set());
  };

  const STATUS_STYLE = {
    draft: 'bg-muted text-muted-foreground',
    scheduled: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-amber-100 text-amber-700',
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <ListChecks className="w-5 h-5 text-primary" />
          <div className="text-left">
            <h2 className="text-base font-semibold">Select Production Runs</h2>
            <p className="text-xs text-muted-foreground">
              {selectedRunIds.size === 0
                ? 'Choose which runs to include in cooking requirements'
                : `${selectedRunIds.size} run${selectedRunIds.size > 1 ? 's' : ''} selected`
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {selectedRunIds.size > 0 && (
            <Badge className="bg-primary/10 text-primary text-xs">{selectedRunIds.size} selected</Badge>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* Date range + actions */}
          <div className="flex items-end gap-4 px-5 py-3 bg-muted/30 border-b border-border flex-wrap">
            <div>
              <label className="text-[10px] text-muted-foreground font-semibold uppercase">From</label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="mt-1 w-36 h-8 text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-semibold uppercase">To</label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="mt-1 w-36 h-8 text-sm" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setDateFrom(todayStr); setDateTo(todayStr); }}>Today only</Button>
              <Button variant="outline" size="sm" onClick={() => { setDateFrom(todayStr); setDateTo(format(addDays(new Date(), 1), 'yyyy-MM-dd')); }}>Today + Tomorrow</Button>
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll}>Select All</Button>
              <Button variant="ghost" size="sm" onClick={clearAll}>Clear</Button>
            </div>
          </div>

          {/* Run list */}
          {isLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading runs...</div>
          ) : filteredRuns.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No scheduled or active production runs in this date range.
            </div>
          ) : (
            <div className="max-h-[30vh] overflow-y-auto divide-y divide-border">
              {filteredRuns.map(r => {
                const isSelected = selectedRunIds.has(r.id);
                return (
                  <label
                    key={r.id}
                    className={cn(
                      'flex items-center gap-4 px-5 py-3 cursor-pointer transition-colors',
                      isSelected ? 'bg-primary/5' : 'hover:bg-muted/30'
                    )}
                  >
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleRun(r.id)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold font-mono">{r.run_number}</span>
                        <Badge className={cn('text-[10px]', STATUS_STYLE[r.status])}>
                          {r.status === 'in_progress' ? 'In Progress' : r.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> {r.run_date}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {r.total_lines || 0} meals · {r.total_units || 0} units
                        </span>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}