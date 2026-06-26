import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { subDays, isWithinInterval, startOfDay } from 'date-fns';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';
import { formatZAR } from '@/lib/utils';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

// Flag a PO when GRN vs invoice differ by more than this fraction (with a small
// absolute floor so tiny rounding diffs on large POs aren't flagged).
const VARIANCE_PCT = 0.02;       // 2%
const VARIANCE_ABS_FLOOR = 5;    // R5

export default function GRNvsInvoiceReconciliationReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);

  const { data: pos = [] } = useQuery({
    queryKey: ['report-rec-pos'],
    queryFn: () => base44.entities.PurchaseOrder.list('-order_date', 2000),
  });
  const { data: grns = [] } = useQuery({
    queryKey: ['report-rec-grns'],
    queryFn: () => base44.entities.GoodsReceivedNote.filter({ status: 'confirmed' }, '-received_date', 2000),
  });
  const { data: invoices = [] } = useQuery({
    queryKey: ['report-rec-invoices'],
    queryFn: () => base44.entities.PurchaseInvoice.list('-invoice_date', 2000),
  });

  const rows = useMemo(() => {
    const inRange = pos.filter(po => po.order_date && isWithinInterval(new Date(po.order_date), { start: startOfDay(from), end: to }));
    return inRange.map(po => {
      const poGrns = grns.filter(g => g.purchase_order_id === po.id);
      const poInvs = invoices.filter(i => i.purchase_order_id === po.id && !i.is_credit_note);
      // Compare like-for-like: GRN total_received_value is VAT-EXCLUSIVE, so use the
      // invoice's ex-VAT subtotal (NOT total, which includes VAT) or every PO flags.
      const grnTotal = poGrns.reduce((s, g) => s + (g.total_received_value || 0), 0);
      const invTotal = poInvs.reduce((s, i) => s + (i.subtotal || 0), 0);
      const variance = Math.abs(grnTotal - invTotal);
      const tolerance = Math.max(VARIANCE_ABS_FLOOR, Math.max(grnTotal, invTotal) * VARIANCE_PCT);
      const hasActivity = poGrns.length > 0 || poInvs.length > 0;
      return { ...po, grnTotal, invTotal, variance, hasActivity, flagged: hasActivity && variance > tolerance };
    })
    // Only show POs that actually have a GRN or invoice — empty/draft POs are not actionable here.
    .filter(r => r.hasActivity);
  }, [pos, grns, invoices, from, to]);

  const flaggedCount = rows.filter(r => r.flagged).length;

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }}
        onExportCSV={() => downloadCSV('grn_invoice_recon.csv', rows.map(r => ({
          po_number: r.po_number, supplier: r.supplier_name, grn_total: r.grnTotal.toFixed(2),
          invoice_total: r.invTotal.toFixed(2), variance: r.variance.toFixed(2), flagged: r.flagged,
        })))}
        onPrint={() => window.print()} />
      {flaggedCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {flaggedCount} PO{flaggedCount !== 1 ? 's' : ''} with GRN-vs-invoice variance &gt; {(VARIANCE_PCT * 100).toFixed(0)}% (ex-VAT)
        </div>
      )}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">PO</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Supplier</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">GRN Total</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">Invoice Total</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">Variance</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(r => (
              <tr key={r.id} className={r.flagged ? 'bg-red-50/50 dark:bg-red-950/20' : ''}>
                <td className="px-4 py-2.5 font-mono text-xs">{r.po_number}</td>
                <td className="px-4 py-2.5 text-xs">{r.supplier_name}</td>
                <td className="px-4 py-2.5 text-right text-xs">{formatZAR(r.grnTotal)}</td>
                <td className="px-4 py-2.5 text-right text-xs">{formatZAR(r.invTotal)}</td>
                <td className={`px-4 py-2.5 text-right text-xs font-semibold ${r.flagged ? 'text-red-600' : 'text-muted-foreground'}`}>
                  {r.variance > 0 ? formatZAR(r.variance) : '—'}
                </td>
                <td className="px-2 py-2.5 text-center">
                  {r.flagged ? <AlertTriangle className="w-3.5 h-3.5 text-red-500" /> : <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">No POs with GRN or invoice activity in this period</p>}
      </div>
    </div>
  );
}
