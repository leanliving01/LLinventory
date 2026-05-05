import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, TrendingUp, TrendingDown, Minus } from 'lucide-react';

const YIELD_THRESHOLD = 80;

export default function YieldHistoryDrawer({ productId, productName, station, onClose }) {
  const { data: allRecords = [], isLoading } = useQuery({
    queryKey: ['yield-history', productId, station],
    queryFn: () => base44.entities.YieldRecord.filter(
      { bulk_product_id: productId, station },
      '-production_date',
      30
    ),
    enabled: !!productId,
  });

  // Calculate rolling average from the history
  const rollingAvg = useMemo(() => {
    if (allRecords.length === 0) return null;
    const validRecords = allRecords.filter(r => r.actual_yield_pct != null);
    if (validRecords.length === 0) return null;
    return validRecords.reduce((sum, r) => sum + r.actual_yield_pct, 0) / validRecords.length;
  }, [allRecords]);

  const bestYield = useMemo(() => {
    if (allRecords.length === 0) return null;
    return Math.max(...allRecords.map(r => r.actual_yield_pct || 0));
  }, [allRecords]);

  const worstYield = useMemo(() => {
    if (allRecords.length === 0) return null;
    return Math.min(...allRecords.map(r => r.actual_yield_pct || 0));
  }, [allRecords]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-card border-l border-border h-full overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h3 className="text-lg font-bold">{productName}</h3>
            <p className="text-xs text-muted-foreground capitalize">
              {station} yield history — last {allRecords.length} runs
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* KPI strip */}
        {rollingAvg != null && (
          <div className="px-5 py-4 flex gap-4 border-b border-border">
            <div className="flex-1 text-center">
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Rolling Avg</p>
              <p className={`text-xl font-bold tabular-nums ${rollingAvg < YIELD_THRESHOLD ? 'text-red-600' : 'text-green-600'}`}>
                {rollingAvg.toFixed(1)}%
              </p>
            </div>
            <div className="w-px bg-border" />
            <div className="flex-1 text-center">
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Best</p>
              <p className="text-xl font-bold tabular-nums text-green-600">{bestYield?.toFixed(1)}%</p>
            </div>
            <div className="w-px bg-border" />
            <div className="flex-1 text-center">
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Worst</p>
              <p className={`text-xl font-bold tabular-nums ${(worstYield || 0) < YIELD_THRESHOLD ? 'text-red-600' : 'text-amber-600'}`}>
                {worstYield?.toFixed(1)}%
              </p>
            </div>
            <div className="w-px bg-border" />
            <div className="flex-1 text-center">
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Runs</p>
              <p className="text-xl font-bold tabular-nums">{allRecords.length}</p>
            </div>
          </div>
        )}

        {/* History list */}
        <div className="px-5 py-4 space-y-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading history...</p>
          ) : allRecords.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No yield history found</p>
          ) : (
            allRecords.map(record => {
              const yieldPct = record.actual_yield_pct || 0;
              const isBad = yieldPct < YIELD_THRESHOLD;
              const variancePct = record.yield_variance_pct || 0;

              return (
                <div
                  key={record.id}
                  className={`rounded-xl border px-4 py-3 ${isBad ? 'border-red-200 bg-red-50/50' : 'border-border bg-card'}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{record.production_date}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {record.recorded_by_name || '—'}
                        {record.production_notes ? ` · ${record.production_notes}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold tabular-nums ${isBad ? 'text-red-600' : yieldPct > 95 ? 'text-green-600' : 'text-foreground'}`}>
                        {yieldPct.toFixed(1)}%
                      </p>
                      <div className="flex items-center justify-end gap-1">
                        {variancePct > 2 ? (
                          <TrendingUp className="w-3 h-3 text-green-600" />
                        ) : variancePct < -5 ? (
                          <TrendingDown className="w-3 h-3 text-red-600" />
                        ) : (
                          <Minus className="w-3 h-3 text-muted-foreground" />
                        )}
                        <span className={`text-[10px] tabular-nums ${variancePct < -5 ? 'text-red-600' : variancePct > 2 ? 'text-green-600' : 'text-muted-foreground'}`}>
                          {variancePct > 0 ? '+' : ''}{variancePct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                    <span>Required: {(record.required_qty || record.actual_raw_issued_kg || 0).toFixed(2)} {record.uom || 'kg'}</span>
                    <span>Actual: {(record.consumed_qty || record.actual_cooked_output_kg || 0).toFixed(2)}</span>
                    {(record.wastage_qty || record.wastage_qty_kg || 0) > 0 && (
                      <span>Waste: {(record.wastage_qty || record.wastage_qty_kg || 0).toFixed(2)}</span>
                    )}
                  </div>
                  {isBad && (
                    <Badge className="bg-red-100 text-red-600 text-[10px] mt-2">Below {YIELD_THRESHOLD}% threshold</Badge>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}