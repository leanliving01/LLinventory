import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { subDays, isWithinInterval, startOfDay } from 'date-fns';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';
import { formatZAR } from '@/lib/utils';

export default function SupplierSpendAnalysisReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);

  const { data: grns = [] } = useQuery({
    queryKey: ['report-grns', startOfDay(from).toISOString(), to.toISOString()],
    queryFn: () => base44.entities.GoodsReceivedNote.filter(
      { status: 'confirmed', received_date: { $gte: startOfDay(from).toISOString(), $lte: to.toISOString() } },
      '-received_date', 5000
    ),
  });

  const inRange = useMemo(() =>
    grns.filter(g => g.received_date && isWithinInterval(new Date(g.received_date), { start: startOfDay(from), end: to })),
    [grns, from, to]
  );

  // Scope GRN lines to the in-range GRNs so spend isn't understated by a global newest-N cap.
  const grnIdList = useMemo(() => inRange.map(g => g.id), [inRange]);
  const { data: grnLines = [] } = useQuery({
    queryKey: ['report-grn-lines', grnIdList],
    queryFn: () => grnIdList.length
      ? base44.entities.GRNLine.filter({ grn_id: grnIdList }, '-created_date', 20000)
      : Promise.resolve([]),
    enabled: grnIdList.length > 0,
  });

  const rows = useMemo(() => {
    const bySupplier = {};
    for (const g of inRange) {
      if (!bySupplier[g.supplier_id]) bySupplier[g.supplier_id] = { supplier_id: g.supplier_id, supplier_name: g.supplier_name, total: 0, grn_count: 0 };
      bySupplier[g.supplier_id].grn_count++;
    }
    const grnById = Object.fromEntries(inRange.map(g => [g.id, g]));
    for (const line of grnLines) {
      const grn = grnById[line.grn_id];
      if (!grn) continue;
      if (!bySupplier[grn.supplier_id]) bySupplier[grn.supplier_id] = { supplier_id: grn.supplier_id, supplier_name: grn.supplier_name, total: 0, grn_count: 0 };
      bySupplier[grn.supplier_id].total += line.line_total || 0;
    }
    return Object.values(bySupplier).sort((a, b) => b.total - a.total);
  }, [inRange, grnLines]);

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }}
        onExportCSV={() => downloadCSV('supplier_spend.csv', rows.map(r => ({ supplier: r.supplier_name, grns: r.grn_count, total: r.total.toFixed(2) })))}
        onPrint={() => window.print()} />
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 bg-muted/40 border-b border-border font-semibold text-sm flex justify-between">
          <span>Supplier</span><span className="text-right">Spend</span>
        </div>
        {rows.map(r => (
          <div key={r.supplier_id || r.supplier_name} className="px-4 py-2.5 flex justify-between items-center border-b border-border last:border-0 text-sm">
            <div>
              <p className="font-medium">{r.supplier_name}</p>
              <p className="text-xs text-muted-foreground">{r.grn_count} receipt{r.grn_count !== 1 ? 's' : ''}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold">{formatZAR(r.total)}</p>
              <p className="text-xs text-muted-foreground">{grandTotal > 0 ? ((r.total / grandTotal) * 100).toFixed(1) : 0}%</p>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">No receipts in this period</p>}
        {rows.length > 0 && (
          <div className="px-4 py-3 bg-muted/40 flex justify-between text-sm font-bold">
            <span>Total</span><span>{formatZAR(grandTotal)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
