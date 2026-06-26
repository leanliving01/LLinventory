import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { format, subDays, isWithinInterval, startOfDay } from 'date-fns';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';

export default function WastageReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);

  const { data: logs = [] } = useQuery({
    queryKey: ['report-wastage-logs', format(startOfDay(from), 'yyyy-MM-dd'), format(to, 'yyyy-MM-dd')],
    queryFn: () => base44.entities.WastageLog.filter(
      { wastage_date: { $gte: format(startOfDay(from), 'yyyy-MM-dd'), $lte: format(to, 'yyyy-MM-dd') } },
      '-wastage_date', 2000
    ),
  });

  const { data: lines = [] } = useQuery({
    queryKey: ['report-wastage-lines'],
    queryFn: () => base44.entities.WastageLine.list('-created_date', 2000),
  });

  const filteredLogs = useMemo(() =>
    logs.filter(l => l.wastage_date && isWithinInterval(new Date(l.wastage_date), { start: startOfDay(from), end: to })),
    [logs, from, to]
  );

  const logIds = useMemo(() => new Set(filteredLogs.map(l => l.id)), [filteredLogs]);

  const filteredLines = useMemo(() =>
    lines.filter(l => logIds.has(l.wastage_log_id)),
    [lines, logIds]
  );

  const totals = useMemo(() => {
    const totalValue = filteredLogs.reduce((s, l) => s + (l.total_rand_value || 0), 0);
    const usable = filteredLines.filter(l => l.waste_type === 'usable');
    const unusable = filteredLines.filter(l => l.waste_type === 'unusable');
    // Top wasted products
    const byProduct = {};
    filteredLines.forEach(l => {
      const key = l.product_sku || l.product_name;
      if (!byProduct[key]) byProduct[key] = { name: l.product_name, sku: l.product_sku, qty: 0, value: 0, uom: l.uom };
      byProduct[key].qty += l.qty || 0;
      byProduct[key].value += l.rand_value || 0;
    });
    const topProducts = Object.values(byProduct).sort((a, b) => b.value - a.value).slice(0, 10);

    return { totalValue, entries: filteredLogs.length, usableCount: usable.length, unusableCount: unusable.length, topProducts };
  }, [filteredLogs, filteredLines]);

  const handleExport = () => {
    downloadCSV('wastage_report.csv', filteredLines.map(l => ({
      date: filteredLogs.find(lg => lg.id === l.wastage_log_id)?.wastage_date || '',
      product: l.product_name, sku: l.product_sku, qty: l.qty, uom: l.uom,
      type: l.waste_type, reason: l.reason || '', value: l.rand_value,
    })));
  };

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} onExportCSV={handleExport} onPrint={() => window.print()} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SumCard label="Wastage Logs" value={totals.entries} />
        <SumCard label="Total Value" value={`R ${Math.round(totals.totalValue).toLocaleString()}`} accent />
        <SumCard label="Usable Items" value={totals.usableCount} />
        <SumCard label="Unusable Items" value={totals.unusableCount} warn={totals.unusableCount > 0} />
      </div>

      {/* Top wasted products */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h4 className="text-sm font-semibold mb-3">Top Wasted Products</h4>
        {totals.topProducts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No wastage data in period</p>
        ) : (
          <div className="space-y-2">
            {totals.topProducts.map((p, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-[10px] text-muted-foreground">{p.sku} · {Math.round(p.qty)} {p.uom}</p>
                </div>
                <p className="text-sm font-semibold text-red-600">R {Math.round(p.value).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Daily breakdown */}
      <div className="border border-border rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Date</th>
              <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Status</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Value (ZAR)</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Submitted By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredLogs.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">No wastage logs in period</td></tr>
            ) : filteredLogs.map(l => (
              <tr key={l.id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5">{l.wastage_date ? format(new Date(l.wastage_date), 'dd MMM yyyy') : '—'}</td>
                <td className="px-4 py-2.5 text-center">
                  <Badge className={`text-[10px] ${l.status === 'locked' ? 'bg-green-100 text-green-700' : l.status === 'submitted' ? 'bg-blue-100 text-blue-700' : 'bg-muted text-muted-foreground'}`}>{l.status}</Badge>
                </td>
                <td className="px-4 py-2.5 text-right font-medium">R {Math.round(l.total_rand_value || 0).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{l.submitted_by || l.created_by || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SumCard({ label, value, accent, warn }) {
  return (
    <div className={`rounded-lg px-4 py-3 border ${accent ? 'bg-red-50 border-red-200' : warn ? 'bg-amber-50 border-amber-200' : 'bg-muted/50 border-border'}`}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${accent ? 'text-red-700' : warn ? 'text-amber-700' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}