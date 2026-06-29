import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44, supabase } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CheckCircle2, AlertTriangle, ShieldCheck, Loader2, Link2, Receipt, Truck, FileText, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { matchThreeWay, parseTolerances, OVERALL_STATUS_META } from '@/lib/threeWayMatch';
import { writeAuditLog } from '@/lib/auditLog';
import ManagerPinDialog from '@/components/purchasing/ManagerPinDialog';

const TONE = {
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-100 text-blue-700',
  gray: 'bg-gray-100 text-gray-600',
};

const LINE_TONE = {
  matched: 'bg-green-50 text-green-700',
  price_variance: 'bg-amber-50 text-amber-700',
  qty_variance: 'bg-red-50 text-red-700',
  unmatched: 'bg-red-50 text-red-700',
};
const LINE_LABEL = {
  matched: 'Matched',
  price_variance: 'Price',
  qty_variance: 'Over-billed',
  unmatched: 'Unmatched',
};

const fmtQty = (n) => (n == null ? '—' : String(Math.round(Number(n) * 100) / 100));
const fmtR = (n) => (n == null ? '—' : `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`);

export default function ThreeWayMatchPanel({ invoice, invoiceLines = [], userName = 'Unknown', canApprove: canAct = true, onUpdated }) {
  const queryClient = useQueryClient();
  const [linkPoId, setLinkPoId] = useState('');
  const [approving, setApproving] = useState(false);
  const [overrideStage, setOverrideStage] = useState(null); // null | 'pin' | 'reason'
  const [overrideReason, setOverrideReason] = useState('');

  const poId = invoice.purchase_order_id || linkPoId || '';
  const isApproved = invoice.status === 'approved';

  // Schema-readiness probe: the approval columns only exist after migration 065.
  // The data layer silently strips unknown columns, so without this an approval
  // could set status='approved' while the match metadata is dropped. If the probe
  // errors (columns absent), we block approval entirely.
  const { data: schemaReady = true } = useQuery({
    queryKey: ['invoice-match-schema-ready'],
    queryFn: async () => {
      const { error } = await supabase
        .from('purchase_invoices')
        .select('id, three_way_match_status, approved_by, match_overridden')
        .limit(1);
      return !error;
    },
    staleTime: Infinity,
  });

  // Tolerances
  const { data: settings = [] } = useQuery({
    queryKey: ['match-tolerances'],
    queryFn: () => base44.entities.Setting.filter({ group: 'purchasing' }, 'key', 50),
    staleTime: 300000,
  });
  const tolerances = useMemo(() => parseTolerances(settings), [settings]);

  // Candidate POs for linking (when the invoice has no PO yet)
  const { data: candidatePOs = [] } = useQuery({
    queryKey: ['match-candidate-pos', invoice.supplier_id],
    queryFn: () => base44.entities.PurchaseOrder.filter({ supplier_id: invoice.supplier_id }, '-created_date', 50),
    enabled: !invoice.purchase_order_id && !!invoice.supplier_id,
  });

  // Linked PO + its lines
  const { data: poList = [] } = useQuery({
    queryKey: ['match-po', poId],
    queryFn: () => base44.entities.PurchaseOrder.filter({ id: poId }),
    enabled: !!poId,
  });
  const po = poList[0] || null;

  const { data: poLines = [] } = useQuery({
    queryKey: ['match-po-lines', poId],
    queryFn: () => base44.entities.PurchaseOrderLine.filter({ purchase_order_id: poId }, 'product_name', 200),
    enabled: !!poId,
  });

  // GRNs for the PO (engine sums received qty across all confirmed ones)
  const { data: grns = [] } = useQuery({
    queryKey: ['match-grns', poId],
    queryFn: () => base44.entities.GoodsReceivedNote.filter({ purchase_order_id: poId }, '-received_date', 50),
    enabled: !!poId,
  });
  const confirmedGRNs = useMemo(() => grns.filter((g) => g.status === 'confirmed'), [grns]);
  const confirmedKey = confirmedGRNs.map((g) => g.id).join(',');

  const { data: grnLines = [] } = useQuery({
    queryKey: ['match-grn-lines', confirmedKey],
    queryFn: async () => {
      const chunks = await Promise.all(
        confirmedGRNs.map((g) => base44.entities.GRNLine.filter({ grn_id: g.id }, 'product_name', 200))
      );
      return chunks.flat();
    },
    enabled: confirmedGRNs.length > 0,
  });

  const result = useMemo(
    () => matchThreeWay({ po, poLines, grns, grnLines, invoice, invoiceLines, tolerances }),
    [po, poLines, grns, grnLines, invoice, invoiceLines, tolerances]
  );

  const meta = OVERALL_STATUS_META[result.overallStatus] || OVERALL_STATUS_META.not_checked;

  // ── Approve / override ────────────────────────────────────────────────────

  // Re-fetch the source documents and recompute the match right before writing,
  // so an approval can never be based on a stale render (e.g. a GRN/invoice line
  // changed in another tab after this drawer opened).
  const computeFresh = async () => {
    const [freshInvLines, freshPoList, freshGrns, freshPoLines] = await Promise.all([
      base44.entities.PurchaseInvoiceLine.filter({ invoice_id: invoice.id }, 'product_name', 200),
      poId ? base44.entities.PurchaseOrder.filter({ id: poId }) : Promise.resolve([]),
      poId ? base44.entities.GoodsReceivedNote.filter({ purchase_order_id: poId }, '-received_date', 50) : Promise.resolve([]),
      poId ? base44.entities.PurchaseOrderLine.filter({ purchase_order_id: poId }, 'product_name', 200) : Promise.resolve([]),
    ]);
    const freshPo = freshPoList[0] || null;
    const freshConfirmed = freshGrns.filter((g) => g.status === 'confirmed');
    const chunks = await Promise.all(
      freshConfirmed.map((g) => base44.entities.GRNLine.filter({ grn_id: g.id }, 'product_name', 200))
    );
    const freshGrnLines = chunks.flat();
    const res = matchThreeWay({
      po: freshPo, poLines: freshPoLines, grns: freshGrns, grnLines: freshGrnLines,
      invoice, invoiceLines: freshInvLines, tolerances,
    });
    return { res, lines: freshInvLines };
  };

  const persistMatch = async (res, lines, { approve, overridden, reason }) => {
    const nowISO = new Date().toISOString();
    const byId = {};
    res.lines.forEach((l) => { if (l.invoice_line_id) byId[l.invoice_line_id] = l; });

    // 1. Persist the per-line match outcome. FAIL HARD — never approve a payment
    //    whose per-line match record couldn't be written.
    await Promise.all(lines.map((il) => {
      const r = byId[il.id];
      if (!r) return null;
      return base44.entities.PurchaseInvoiceLine.update(il.id, {
        ordered_qty: r.orderedQty,
        received_qty: r.receivedQty,
        qty_variance: r.qtyOver,
        qty_variance_flagged: r.qtyExceeds,
        price_variance_pct: r.priceVariancePct != null ? Math.round(r.priceVariancePct * 10) / 10 : null,
        price_variance_flagged: r.priceExceeds,
        match_line_status: r.lineStatus,
      });
    }));

    // 2. Update the invoice header
    const headerPatch = {
      three_way_match_status: res.overallStatus,
      three_way_checked_at: nowISO,
      three_way_checked_by: userName,
      total_variance: res.headerVariance ?? null,
    };
    if (!invoice.purchase_order_id && linkPoId) headerPatch.purchase_order_id = linkPoId;
    if (!invoice.grn_id && res.confirmedGRNs?.[0]) headerPatch.grn_id = res.confirmedGRNs[0].id;
    if (approve) {
      headerPatch.status = 'approved';
      headerPatch.approved_by = userName;
      headerPatch.approved_at = nowISO;
      headerPatch.match_overridden = !!overridden;
      headerPatch.match_override_reason = overridden ? (reason || null) : null;
    }
    await base44.entities.PurchaseInvoice.update(invoice.id, headerPatch);

    writeAuditLog({
      action: approve ? 'finalize' : 'update',
      entity_type: 'PurchaseInvoice',
      entity_id: invoice.id,
      description: approve
        ? `${overridden ? 'Override-approved' : 'Approved'} invoice ${invoice.invoice_number} for payment (3-way match: ${res.overallStatus}${overridden && reason ? ` — override reason: ${reason}` : ''})`
        : `Recorded 3-way match for invoice ${invoice.invoice_number}: ${res.overallStatus}`,
    });
  };

  const guardReady = () => {
    if (!schemaReady) {
      toast.error('Database not ready — run migration 065 before approving invoices.');
      return false;
    }
    return true;
  };

  const handleApprove = async () => {
    if (approving || !guardReady()) return;
    setApproving(true);
    try {
      const { res, lines } = await computeFresh();
      if (!res.canApprove) {
        toast.error('The match changed since you opened this — re-review before approving.');
        queryClient.invalidateQueries({ queryKey: ['match-po-lines', poId] });
        queryClient.invalidateQueries({ queryKey: ['match-grns', poId] });
        queryClient.invalidateQueries({ queryKey: ['match-grn-lines', confirmedKey] });
        onUpdated?.();
        return;
      }
      await persistMatch(res, lines, { approve: true, overridden: false, reason: null });
      toast.success('Invoice approved for payment');
      onUpdated?.();
    } catch (err) {
      toast.error('Approve failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setApproving(false);
    }
  };

  const handleSaveCheck = async () => {
    if (approving || !guardReady()) return;
    setApproving(true);
    try {
      const { res, lines } = await computeFresh();
      await persistMatch(res, lines, { approve: false });
      toast.success('Match result saved');
      onUpdated?.();
    } catch (err) {
      toast.error('Save failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setApproving(false);
    }
  };

  const handleOverrideConfirmed = async () => {
    if (approving) return;
    if (!overrideReason.trim()) { toast.error('Enter a reason for the override'); return; }
    if (!guardReady()) return;
    setOverrideStage(null);
    setApproving(true);
    try {
      const { res, lines } = await computeFresh();
      await persistMatch(res, lines, { approve: true, overridden: true, reason: overrideReason.trim() });
      toast.success('Invoice override-approved for payment');
      setOverrideReason('');
      onUpdated?.();
    } catch (err) {
      toast.error('Override failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setApproving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-4">
      {/* Status header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-bold">Three-Way Match</h3>
          <Badge className={`text-[10px] ${TONE[meta.tone]}`}>{meta.label}</Badge>
          {invoice.match_overridden && (
            <Badge className="text-[10px] bg-purple-100 text-purple-700">Overridden</Badge>
          )}
        </div>
        {isApproved && (
          <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Approved{invoice.approved_by ? ` by ${invoice.approved_by}` : ''}
          </span>
        )}
      </div>

      {/* Document totals */}
      <div className="grid grid-cols-3 gap-3">
        <DocStat icon={Receipt} label="Purchase Order" value={fmtR(result.totals.poTotal)} sub={po?.po_number} exists={result.hasPO} />
        <DocStat icon={Truck} label="Goods Received" value={fmtR(result.totals.grnTotal)} sub={confirmedGRNs.length ? `${confirmedGRNs.length} GRN${confirmedGRNs.length !== 1 ? 's' : ''}` : null} exists={result.hasGRN} />
        <DocStat icon={FileText} label="Invoice" value={fmtR(result.totals.invTotal)} sub={invoice.invoice_number} exists />
      </div>

      {/* PO link prompt when none linked */}
      {!result.hasPO && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
            <Link2 className="w-4 h-4" /> Link a purchase order to match against
          </div>
          {candidatePOs.length === 0 ? (
            <p className="text-xs text-blue-700">No purchase orders found for this supplier. This invoice can't be three-way matched — a manager can still override-approve it below.</p>
          ) : (
            <Select value={linkPoId} onValueChange={setLinkPoId}>
              <SelectTrigger className="bg-card"><SelectValue placeholder="Select a purchase order..." /></SelectTrigger>
              <SelectContent>
                {candidatePOs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.po_number} — {fmtR(p.total)} ({(p.status || '').replace(/_/g, ' ')})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {result.hasPO && !result.hasGRN && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          No confirmed GRN for this PO yet — receive the goods before the quantity side can be matched.
        </div>
      )}

      {/* Line comparison */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Ordered</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Received</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Invoiced</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">PO Cost</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Inv Cost</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Price Δ</th>
              <th className="text-center px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Match</th>
            </tr>
          </thead>
          <tbody>
            {result.lines.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8 text-sm text-muted-foreground">No invoice lines to match.</td></tr>
            ) : result.lines.map((l, idx) => (
              <tr key={l.invoice_line_id || idx} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">{l.product_name || <span className="text-muted-foreground italic">Unmapped line</span>}</div>
                  {l.product_sku && <div className="text-[10px] text-muted-foreground">{l.product_sku}</div>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtQty(l.orderedQty)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtQty(l.receivedQty)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className={l.qtyExceeds ? 'text-red-600 font-semibold inline-flex items-center gap-1' : ''}>
                    {l.qtyExceeds && <AlertTriangle className="w-3.5 h-3.5" />}
                    {fmtQty(l.invoicedQty)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{l.poUnitCost == null ? '—' : fmtR(l.poUnitCost)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtR(l.invUnitCost)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {l.priceVariancePct == null ? (
                    <span className="text-muted-foreground text-xs">—</span>
                  ) : (
                    <span className={l.priceExceeds ? 'text-amber-600 font-semibold' : 'text-muted-foreground text-xs'}>
                      {l.priceVariancePct > 0 ? '+' : ''}{l.priceVariancePct.toFixed(1)}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${LINE_TONE[l.lineStatus]}`}>
                    {LINE_LABEL[l.lineStatus]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Exceptions summary */}
      {result.exceptions.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
          <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> {result.exceptions.length} exception{result.exceptions.length !== 1 ? 's' : ''} blocking approval
          </p>
          {result.exceptions.map((ex, i) => (
            <p key={i} className="text-xs text-amber-700 pl-5">• {ex.message}</p>
          ))}
        </div>
      )}

      {/* Tolerance footnote */}
      <p className="text-[11px] text-muted-foreground">
        Tolerances: price ±{tolerances.pricePct}% · over-billing {tolerances.qtyOverPct}% · rounding {fmtR(tolerances.valueAbs)}.
        Editable in Settings → Purchasing.
      </p>

      {/* Migration-not-applied guard */}
      {!schemaReady && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Match columns are missing from the database — run migration 065 before approving invoices, or the approval audit won't be saved.
        </div>
      )}

      {/* Actions */}
      {!isApproved && canAct && (
        <div className="flex items-center gap-3 pt-1 border-t border-border">
          <Button variant="outline" size="sm" onClick={handleSaveCheck} disabled={approving || !schemaReady} className="gap-2">
            {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Save Match Result
          </Button>
          <div className="flex-1" />
          {result.canApprove ? (
            <Button size="sm" onClick={handleApprove} disabled={approving || !schemaReady} className="gap-2 bg-green-600 hover:bg-green-700">
              {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Approve for Payment
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => setOverrideStage('pin')}
              disabled={approving || !schemaReady}
              className="gap-2 bg-amber-600 hover:bg-amber-700"
            >
              {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Override &amp; Approve
            </Button>
          )}
        </div>
      )}

      {invoice.match_overridden && invoice.match_override_reason && (
        <p className="text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded px-3 py-2">
          <strong>Override reason:</strong> {invoice.match_override_reason}
        </p>
      )}

      {/* Manager PIN for override */}
      {overrideStage === 'pin' && (
        <ManagerPinDialog
          action="override the three-way match and approve this invoice for payment"
          onConfirmed={() => setOverrideStage('reason')}
          onCancel={() => setOverrideStage(null)}
        />
      )}

      {/* Override reason capture */}
      {overrideStage === 'reason' && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[300]" onClick={() => setOverrideStage(null)} />
          <div className="fixed inset-0 z-[310] flex items-center justify-center p-4">
            <div className="bg-card rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  <h3 className="font-semibold text-sm">Reason for override</h3>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOverrideStage(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This invoice has match exceptions. Record why it's being approved for payment anyway — this is logged to the audit trail.
              </p>
              <Textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. Supplier confirmed price increase by email; agreed to absorb the short delivery."
                className="h-24"
                autoFocus
              />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setOverrideStage(null)}>Cancel</Button>
                <Button className="flex-1 gap-2 bg-amber-600 hover:bg-amber-700" onClick={handleOverrideConfirmed} disabled={approving}>
                  {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Approve for Payment
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DocStat({ icon: Icon, label, value, sub, exists }) {
  return (
    <div className={`rounded-lg border p-3 ${exists ? 'border-border bg-card' : 'border-dashed border-border bg-muted/30'}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${exists ? 'text-primary' : 'text-muted-foreground'}`} />
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</span>
      </div>
      <p className="text-sm font-bold tabular-nums">{exists ? value : '—'}</p>
      {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
    </div>
  );
}
