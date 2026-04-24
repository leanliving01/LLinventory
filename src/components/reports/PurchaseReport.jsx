import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { format, subDays, isWithinInterval, startOfDay } from 'date-fns';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';

const STATUS_STYLES = {
  draft: 'bg-muted text-muted-foreground',
  confirmed: 'bg-blue-100 text-blue-700',
  partially_received: 'bg-amber-100 text-amber-700',
  received: 'bg-green-100 text-green-700',
  invoiced: 'bg-purple-100 text-purple-700',
  paid: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function PurchaseReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);

  const { data: pos = [] } = useQuery({
    queryKey: ['report-pos'],
    queryFn: () => base44.entities.PurchaseOrder.list('-order_date', 500),
  });

  const filtered = useMemo(() =>
    pos.filter(po => po.order_date && isWithinInterval(new Date(po.order_date), { start: startOfDay(from), end: to })),
    [pos, from, to]
  );

  const totals = useMemo(() => {
    const confirmed = filtered.filter(p => !['draft', 'cancelled'].includes(p.status));
    return {
      count: filtered.length,
      subtotal: confirmed.reduce((s, p) => s + (p.subtotal || 0), 0),
      tax: confirmed.reduce((s, p) => s + (p.tax || 0), 0),
      total: confirmed.reduce((s, p) => s + (p.total || 0), 0),
      paid: confirmed.filter(p => p.payment_status === 'paid').reduce((s, p) => s + (p.total || 0), 0),
    };
  }, [filtered]);

  const handleExport = () => {
    downloadCSV('purchase_report.csv', filtered.map(p => ({
      po_number: p.po_number, supplier: p.supplier_name, status: p.status,
      order_date: p.order_date, expected_date: p.expected_date || '',
      subtotal: p.subtotal, tax: p.tax, total: p.total, payment: p.payment_status,
    })));
  };

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} onExportCSV={handleExport} onPrint={() => window.print()} />

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Orders" value={totals.count} />
        <SummaryCard label="Subtotal" value={`R ${totals.subtotal.toLocaleString()}`} />
        <SummaryCard label="VAT" value={`R ${totals.tax.toLocaleString()}`} />
        <SummaryCard label="Total Spend" value={`R ${totals.total.toLocaleString()}`} accent />
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">PO #</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Supplier</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Date</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Total</th>
              <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Status</th>
              <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Payment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">No purchase orders in period</td></tr>
            ) : filtered.map(po => (
              <tr key={po.id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5 font-medium">{po.po_number}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{po.supplier_name || '—'}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{po.order_date ? format(new Date(po.order_date), 'dd MMM yyyy') : '—'}</td>
                <td className="px-4 py-2.5 text-right font-medium">R {(po.total || 0).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-center">
                  <Badge className={`text-[10px] ${STATUS_STYLES[po.status] || ''}`}>{(po.status || '').replace('_', ' ')}</Badge>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <Badge variant="outline" className="text-[10px]">{po.payment_status || '—'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent }) {
  return (
    <div className={`rounded-lg px-4 py-3 ${accent ? 'bg-primary/10 border border-primary/20' : 'bg-muted/50 border border-border'}`}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}