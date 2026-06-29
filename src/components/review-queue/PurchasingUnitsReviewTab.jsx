import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowRightLeft, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import PurchaseUnitReviewModal from '@/components/settings/PurchaseUnitReviewModal';

/**
 * "Product Auditing" tab of the Review Queue.
 *
 * An audit of ALREADY-linked supplier products whose conversion factor looks wrong
 * (e.g. a 10kg box mistakenly set to "1 kg"), which silently corrupts costing.
 * Flagged by the `propose-purchase-units` maintenance run in Settings → Sync; each
 * row opens the rich purchasing-unit editor with the supplier evidence auto-pulled
 * so you can confirm or correct the conversion. Separate from linking new items.
 */
export default function PurchasingUnitsReviewTab() {
  const [busy, setBusy] = useState(null);          // 'all' | <proposalId>
  const [reviewProposal, setReviewProposal] = useState(null);

  const { data: proposals = [], refetch } = useQuery({
    queryKey: ['purchase-unit-proposals'],
    queryFn: () => base44.entities.PurchaseUnitProposal.filter({ status: 'pending' }, '-confidence', 300),
  });

  // Write a proposal's values onto the supplier product. No toast (used in bulk).
  const applyProposal = async (p) => {
    const conv = Number(p.proposed_conversion_factor);
    if (!Number.isFinite(conv) || conv <= 0) {
      throw new Error('No valid proposed conversion — open Review to fix it manually (e.g. set the stock unit)');
    }
    const spList = await base44.entities.SupplierProduct.filter({ id: p.supplier_product_id });
    const sp = spList[0];
    if (!sp) throw new Error('Supplier product not found');
    const yf = Number(sp.yield_factor) || 1;
    const update = {
      purchase_uom: p.proposed_purchase_uom || sp.purchase_uom,
      conversion_factor: conv,
      conversion_uom: p.stock_uom || sp.conversion_uom,
      purchase_uom_label: p.proposed_purchase_uom_label || sp.purchase_uom_label,
      effective_internal_qty: Math.round(conv * yf * 1000) / 1000,
    };
    if ((p.proposed_supplier_sku || '') && !(sp.supplier_sku || '')) update.supplier_sku = p.proposed_supplier_sku;
    await base44.entities.SupplierProduct.update(sp.id, update);
    await base44.entities.PurchaseUnitProposal.update(p.id, { status: 'applied', applied_at: new Date().toISOString() });
  };

  const rejectOne = async (p) => {
    setBusy(p.id);
    try { await base44.entities.PurchaseUnitProposal.update(p.id, { status: 'rejected' }); refetch(); }
    catch (err) { toast.error(`Failed: ${err.message}`); }
    setBusy(null);
  };

  const approveAll = async () => {
    setBusy('all');
    let n = 0;
    for (const p of proposals) { try { await applyProposal(p); n++; } catch { /* skip */ } }
    toast.success(`Applied ${n} of ${proposals.length}`);
    refetch();
    setBusy(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground max-w-2xl">
          Audit of already-linked products whose <strong>conversion factor</strong> looks wrong (e.g. a 10kg box set to
          "1 kg") — these quietly corrupt costing. The analysis runs as a maintenance task in
          <strong> Settings → Sync → Purchasing Units</strong>; review what it flags here. Click <strong>Review</strong> to
          open the full editor (supplier UoM, description, unit price → price per stock unit).
        </p>
        {proposals.length > 0 && (
          <Button variant="outline" size="sm" onClick={approveAll} disabled={!!busy} className="gap-1.5 h-8 text-xs shrink-0">
            {busy === 'all' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
            Approve all ({proposals.length})
          </Button>
        )}
      </div>

      {proposals.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
            <ArrowRightLeft className="w-8 h-8 text-green-500" />
          </div>
          <p className="text-sm font-medium text-foreground">No conversions to audit</p>
          <p className="text-xs text-muted-foreground mt-1">
            Run the analysis in Settings → Sync to surface mis-set conversion factors.
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border">
          {proposals.map(p => (
            <div key={p.id} className="p-3 flex items-start gap-3 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{p.product_name}</p>
                <p className="text-muted-foreground">{p.supplier_name}</p>
                <p className="mt-1">
                  <span className="text-muted-foreground">
                    {p.current_purchase_uom_label || p.current_purchase_uom || '—'} · 1 = {p.current_conversion_factor} {p.stock_uom}
                  </span>
                  <span className="mx-1">→</span>
                  <span className="text-green-700 font-medium">
                    {p.proposed_purchase_uom_label || p.proposed_purchase_uom} · 1 = {p.proposed_conversion_factor} {p.stock_uom}
                  </span>
                  <span className="text-muted-foreground ml-1">({Math.round((p.confidence || 0) * 100)}%)</span>
                </p>
                {p.reasoning && <p className="text-muted-foreground mt-0.5 italic">{p.reasoning}</p>}
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button variant="outline" size="sm" className="h-7 text-xs border-primary/40 text-primary"
                  onClick={() => setReviewProposal(p)} disabled={!!busy}>
                  Review →
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
                  onClick={() => rejectOne(p)} disabled={!!busy}>
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {reviewProposal && (
        <PurchaseUnitReviewModal
          proposal={reviewProposal}
          onClose={() => setReviewProposal(null)}
          onSaved={() => { setReviewProposal(null); refetch(); }}
        />
      )}
    </div>
  );
}
