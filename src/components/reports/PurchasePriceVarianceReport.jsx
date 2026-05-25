import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { subDays, isWithinInterval, startOfDay } from 'date-fns';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';
import { formatZAR } from '@/lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function PurchasePriceVarianceReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);

  const { data: history = [] } = useQuery({
    queryKey: ['report-price-history'],
    queryFn: () => base44.entities.SupplierPriceHistory.list('-effective_date', 2000),
  });

  const rows = useMemo(() =>
    history.filter(h => h.effective_date && isWithinInterval(new Date(h.effective_date), { start: startOfDay(from), end: to }))
      .sort((a, b) => Math.abs(b.change_pct || 0) - Math.abs(a.change_pct || 0)),
    [history, from, to]);

  const flagged = rows.filter(r => Math.abs(r.change_pct || 0) > 10);

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }}
        onExportCSV={() => downloadCSV('price_variance.csv', rows.map(r => ({
          product: r.product_name, sku: r.product_sku, supplier: r.supplier_name,
          prev_price: r.previous_price, new_price: r.price, change_pct: r.change_pct, date: r.effective_date,
        })))}
        onPrint={() => window.print()} />
      {flagged.length > 0 && (
        <div className="text-sm font-medium text-amber-700 bg-amber-50 rounded-lg px-4 py-2 border border-amber-200">
          {flagged.length} price change{flagged.length !== 1 ? 's' : ''} exceed 10% variance
        </div>
      )}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Supplier</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">Previous</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">New</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-20">Change</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => {
              const pct = r.change_pct || 0;
              const flagRow = Math.abs(pct) > 10;
              return (
                <tr key={i} className={flagRow ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-xs">{r.product_name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{r.product_sku}</p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.supplier_name}</td>
                  <td className="px-4 py-2.5 text-xs text-right">{formatZAR(r.previous_price)}</td>
                  <td className="px-4 py-2.5 text-xs text-right font-medium">{formatZAR(r.price)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={`flex items-center justify-end gap-0.5 text-xs font-semibold ${pct > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {pct > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right text-muted-foreground">{r.effective_date}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">No price changes in this period</p>}
      </div>
    </div>
  );
}
