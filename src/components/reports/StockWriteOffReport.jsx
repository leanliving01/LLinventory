import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { format, subDays, isWithinInterval, startOfDay } from 'date-fns';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';
import { formatZAR } from '@/lib/utils';

const REASON_LABELS = {
  quality_deterioration: 'Quality deterioration',
  shelf_life_exceeded: 'Shelf life exceeded',
  contamination: 'Contamination',
  damaged: 'Damaged',
  stocktake_variance: 'Stocktake variance',
  other: 'Other',
};

export default function StockWriteOffReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);

  // Only confirmed write-offs represent a real stock/cost reduction (drafts are pending).
  const { data: writeOffs = [] } = useQuery({
    queryKey: ['report-stock-writeoffs', format(startOfDay(from), 'yyyy-MM-dd'), format(to, 'yyyy-MM-dd')],
    queryFn: () => base44.entities.StockWriteOff.filter(
      { status: 'confirmed', write_off_date: { $gte: format(startOfDay(from), 'yyyy-MM-dd'), $lte: format(to, 'yyyy-MM-dd') } },
      '-write_off_date', 5000
    ),
  });

  const filtered = useMemo(() =>
    writeOffs.filter(w => w.write_off_date && isWithinInterval(new Date(w.write_off_date), { start: startOfDay(from), end: to })),
    [writeOffs, from, to]
  );

  const totals = useMemo(() => {
    const byReason = {};
    let value = 0;
    for (const w of filtered) {
      const r = w.reason || 'other';
      byReason[r] = (byReason[r] || 0) + (w.total_value || 0);
      value += w.total_value || 0;
    }
    return { count: filtered.length, value, byReason: Object.entries(byReason).sort((a, b) => b[1] - a[1]) };
  }, [filtered]);

  const handleExport = () => {
    downloadCSV('stock_write_offs.csv', filtered.map(w => ({
      write_off_number: w.write_off_number || '', date: w.write_off_date || '',
      sku: w.product_sku || '', product: w.product_name || '',
      qty: w.qty, uom: w.uom || '', unit_cost: w.unit_cost, total_value: w.total_value,
      reason: REASON_LABELS[w.reason] || w.reason, confirmed_by: w.confirmed_by_name || '',
    })));
  };

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} onExportCSV={handleExport} onPrint={() => window.print()} />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <SumCard label="Write-Offs" value={totals.count} />
        <SumCard label="Total Value" value={formatZAR(totals.value)} accent />
        <SumCard label="Reasons" value={totals.byReason.length} />
      </div>

      {totals.byReason.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {totals.byReason.map(([reason, val]) => (
            <Badge key={reason} variant="outline" className="text-[11px]">{REASON_LABELS[reason] || reason}: {formatZAR(val)}</Badge>
          ))}
        </div>
      )}

      <div className="border border-border rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Write-Off</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Reason</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Date</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Qty</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">No confirmed stock write-offs in period</td></tr>
            ) : filtered.slice(0, 100).map(w => (
              <tr key={w.id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5 font-mono text-xs">{w.write_off_number || '—'}</td>
                <td className="px-4 py-2.5">
                  <p className="text-xs font-medium">{w.product_name || '—'}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">{w.product_sku}</p>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{REASON_LABELS[w.reason] || w.reason}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{w.write_off_date ? format(new Date(w.write_off_date), 'dd MMM yyyy') : '—'}</td>
                <td className="px-4 py-2.5 text-right">{(w.qty || 0).toFixed(2)} {w.uom || ''}</td>
                <td className="px-4 py-2.5 text-right font-medium">{formatZAR(w.total_value || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 100 && <p className="text-xs text-muted-foreground text-center py-2">Showing 100 of {filtered.length} — export CSV for full data</p>}
      </div>
    </div>
  );
}

function SumCard({ label, value, accent }) {
  return (
    <div className={`rounded-lg px-4 py-3 ${accent ? 'bg-primary/10 border border-primary/20' : 'bg-muted/50 border border-border'}`}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}
