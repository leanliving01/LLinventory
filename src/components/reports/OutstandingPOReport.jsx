import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { differenceInCalendarDays } from 'date-fns';
import { downloadCSV } from '@/lib/csvExport';
import { formatZAR } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Printer } from 'lucide-react';

export default function OutstandingPOReport() {
  const { data: pos = [] } = useQuery({
    queryKey: ['report-outstanding-pos'],
    queryFn: () => base44.entities.PurchaseOrder.filter({}, '-order_date', 2000),
  });

  const rows = useMemo(() => {
    const today = new Date();
    return pos
      .filter(po => ['approved', 'confirmed', 'partially_received'].includes(po.status))
      .map(po => {
        const age = po.order_date ? differenceInCalendarDays(today, new Date(po.order_date)) : 0;
        return { ...po, age };
      })
      .sort((a, b) => b.age - a.age);
  }, [pos]);

  const totalValue = rows.reduce((s, r) => s + (r.total || 0), 0);

  const rowClass = (age) => {
    if (age > 14) return 'bg-red-50/50 dark:bg-red-950/20';
    if (age > 7) return 'bg-amber-50/50 dark:bg-amber-950/20';
    return '';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{rows.length} outstanding PO{rows.length !== 1 ? 's' : ''}</p>
          <p className="text-xs text-muted-foreground">Total value: {formatZAR(totalValue)}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadCSV('outstanding_pos.csv', rows.map(r => ({
            po_number: r.po_number, supplier: r.supplier_name, status: r.status,
            order_date: r.order_date, expected: r.expected_date || '', total: r.total, age_days: r.age,
          })))} className="gap-1.5 h-8 text-xs"><Download className="w-3.5 h-3.5" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5 h-8 text-xs"><Printer className="w-3.5 h-3.5" /> Print</Button>
        </div>
      </div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">PO</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Supplier</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">Status</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">Age</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">Expected</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(r => (
              <tr key={r.id} className={rowClass(r.age)}>
                <td className="px-4 py-2.5 font-mono text-xs">{r.po_number}</td>
                <td className="px-4 py-2.5 text-xs">{r.supplier_name}</td>
                <td className="px-4 py-2.5"><Badge className="text-[10px]">{r.status?.replace('_', ' ')}</Badge></td>
                <td className={`px-4 py-2.5 text-right text-xs font-medium ${r.age > 14 ? 'text-red-600' : r.age > 7 ? 'text-amber-600' : ''}`}>
                  {r.age}d
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{r.expected_date || '—'}</td>
                <td className="px-4 py-2.5 text-right text-xs font-semibold">{formatZAR(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">No outstanding purchase orders</p>}
      </div>
      <p className="text-[11px] text-muted-foreground">
        <span className="inline-block w-3 h-3 bg-amber-100 rounded mr-1 align-middle"></span>Amber = 8–14 days &nbsp;
        <span className="inline-block w-3 h-3 bg-red-100 rounded mr-1 align-middle"></span>Red = 14+ days
      </p>
    </div>
  );
}
