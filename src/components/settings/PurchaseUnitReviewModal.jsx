import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X, Loader2, Check, Truck, FileText, ExternalLink, ArrowRightLeft } from 'lucide-react';
import { formatZAR } from '@/lib/utils';
import { toast } from 'sonner';
import UomSelect from '@/components/shared/UomSelect';
import SupplierEvidencePanel from '@/components/review-queue/SupplierEvidencePanel';
import { analyzeInvoiceLine, EVIDENCE_REASONS } from '@/lib/invoiceEvidence';

/**
 * Review one purchasing-unit proposal in the SAME rich editor used when matching
 * an invoice line / setting a product's supplier unit. Shows the invoice
 * evidence (UoM, description, unit price) + the source PDF, and lets you set the
 * full purchasing unit: 1 purchase unit = X stock units, at a nominal cost,
 * giving the price per stock unit. On save it writes the supplier product and
 * marks the proposal applied.
 *
 * Worked example (your Brown Rice): UoM "Bale of 10" × description "2kg" = 20kg;
 * unit price R670 ÷ 20 = R33.50/kg.
 */
export default function PurchaseUnitReviewModal({ proposal, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);

  // The live supplier product (source of truth for what we'll write back).
  const { data: sp, isLoading: spLoading } = useQuery({
    queryKey: ['sp-for-pu-review', proposal.supplier_product_id],
    queryFn: async () => {
      const list = await base44.entities.SupplierProduct.filter({ id: proposal.supplier_product_id });
      return list[0] || null;
    },
  });

  // Invoice evidence for this supplier + product (description / unit / price) + the source PDFs.
  const { data: evidence = { lines: [], docs: [] } } = useQuery({
    queryKey: ['pu-evidence', proposal.supplier_product_id],
    queryFn: async () => {
      if (!sp) return { lines: [], docs: [] };
      const invs = await base44.entities.PurchaseInvoice.filter({ supplier_id: sp.supplier_id }, '-invoice_date', 150);
      const invById = new Map(invs.map(i => [i.id, i]));
      const lns = await base44.entities.PurchaseInvoiceLine.filter({ product_id: sp.product_id }, '-created_date', 60);
      const mine = lns.filter(l => invById.has(l.invoice_id)).slice(0, 5)
        .map(l => ({ ...l, invoice: invById.get(l.invoice_id) }));
      let docs = [];
      const invIds = [...new Set(mine.map(l => l.invoice_id))];
      if (invIds.length) {
        const atts = await base44.entities.PurchaseAttachment.filter({ source: 'xero' }, '-created_date', 500);
        docs = atts.filter(a => invIds.includes(a.invoice_id)).slice(0, 3);
      }
      return { lines: mine, docs };
    },
    enabled: !!sp,
  });

  const stockUom = proposal.stock_uom || sp?.conversion_uom || 'unit';
  const latestLine = evidence.lines[0];

  const [form, setForm] = useState(null);
  // Initialise the form once sp loads.
  React.useEffect(() => {
    if (sp && !form) {
      setForm({
        purchase_uom_label: sp.purchase_uom_label || '',
        purchase_uom: sp.purchase_uom || 'each',
        conversion_factor: proposal.proposed_conversion_factor != null
          ? String(proposal.proposed_conversion_factor)
          : (sp.conversion_factor != null ? String(sp.conversion_factor) : ''),
        yield_factor: sp.yield_factor != null ? String(sp.yield_factor) : '1',
        nominal_cost: sp.last_purchase_price ? String(sp.last_purchase_price) : '',
        supplier_sku: sp.supplier_sku || '',
      });
    }
  }, [sp]); // eslint-disable-line

  // Auto-pull the supplier evidence (UoM / SKU / description / unit price) from
  // the invoice PDF when the modal opens, and pre-fill any empty fields.
  const [pdfEvidence, setPdfEvidence] = useState(null);
  const [evLoading, setEvLoading] = useState(false);
  const [evError, setEvError] = useState(null);
  const autoRan = React.useRef(false);
  const runAnalyze = async ({ silent = false } = {}) => {
    if (!latestLine?.invoice_id) { if (!silent) toast.error('No invoice PDF available for this product yet.'); return; }
    setEvLoading(true);
    setEvError(null);
    try {
      const result = await analyzeInvoiceLine({
        invoiceId: latestLine.invoice_id,
        line: { xero_item_code: sp?.supplier_sku, xero_description: latestLine.xero_description },
        stockUom,
      });
      if (!result.ok) {
        setEvError(EVIDENCE_REASONS[result.reason] || result.reason || 'Could not read the invoice.');
        return;
      }
      const ev = result.evidence;
      setPdfEvidence(ev);
      setForm(prev => prev && ({
        ...prev,
        supplier_sku: silent ? (prev.supplier_sku || ev.sku) : (ev.sku || prev.supplier_sku),
        purchase_uom_label: silent ? (prev.purchase_uom_label || ev.uom || ev.description) : (ev.uom || ev.description || prev.purchase_uom_label),
        purchase_uom: silent && prev.purchase_uom && prev.purchase_uom !== 'each'
          ? prev.purchase_uom : (ev.uom ? String(ev.uom).toLowerCase() : prev.purchase_uom),
        conversion_factor: ev.conversion != null && (!silent || !prev.conversion_factor) ? String(ev.conversion) : prev.conversion_factor,
        nominal_cost: ev.unitPrice != null && (!silent || !prev.nominal_cost) ? String(ev.unitPrice) : prev.nominal_cost,
      }));
      if (!silent) toast.success('Pre-filled from the invoice — verify the conversion & price.');
    } catch (err) {
      setEvError(`Analysis failed: ${err.message}`);
    } finally {
      setEvLoading(false);
    }
  };
  React.useEffect(() => {
    if (form && latestLine?.invoice_id && !autoRan.current) {
      autoRan.current = true;
      runAnalyze({ silent: true });
    }
  }, [form, latestLine]); // eslint-disable-line

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const cf = parseFloat(form?.conversion_factor);
  const yf = parseFloat(form?.yield_factor) || 1;
  const nc = parseFloat(form?.nominal_cost);
  const pricePerStock = cf > 0 && nc >= 0 && yf > 0 ? nc / (cf * yf) : null;

  const handleSave = async () => {
    if (!form?.conversion_factor || !(cf > 0)) { toast.error('Enter a conversion factor (1 purchase unit = X stock)'); return; }
    setSaving(true);
    try {
      await base44.entities.SupplierProduct.update(sp.id, {
        purchase_uom: form.purchase_uom || sp.purchase_uom,
        purchase_uom_label: form.purchase_uom_label.trim(),
        conversion_factor: cf,
        conversion_uom: stockUom,
        yield_factor: yf,
        effective_internal_qty: Math.round(cf * yf * 1000) / 1000,
        last_purchase_price: nc >= 0 ? nc : sp.last_purchase_price,
        supplier_sku: form.supplier_sku.trim() || sp.supplier_sku,
      });
      await base44.entities.PurchaseUnitProposal.update(proposal.id, {
        status: 'applied', applied_at: new Date().toISOString(),
        proposed_conversion_factor: cf, proposed_purchase_uom: form.purchase_uom,
        proposed_purchase_uom_label: form.purchase_uom_label.trim(),
      });
      toast.success(`Saved ${proposal.product_name} — 1 ${form.purchase_uom} = ${cf} ${stockUom}`);
      onSaved?.();
    } catch (err) {
      toast.error(`Save failed: ${err.message}`);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-primary" /> Set Purchasing Unit
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
              <span>{proposal.product_name}</span>
              <span className="flex items-center gap-1"><Truck className="w-3 h-3" /> {proposal.supplier_name}</span>
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {spLoading || !form ? (
            <div className="text-center py-10 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <>
              {/* Invoice evidence — the source of truth (UoM · description · unit price) */}
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-1.5">
                <p className="text-[10px] uppercase font-semibold text-muted-foreground">From the invoices</p>
                {evidence.lines.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No matched invoice lines found for this supplier + product.</p>
                ) : evidence.lines.map((l, i) => (
                  <div key={i} className="text-xs flex items-start gap-2">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="font-medium">{l.xero_description || '—'}</span>
                      <span className="block text-muted-foreground tabular-nums">
                        {l.unit ? `${l.unit} · ` : ''}{l.qty} × {formatZAR(l.unit_cost || 0)}
                        {l.line_total != null && <> = {formatZAR(l.line_total)}</>}
                        {l.invoice?.invoice_number && <> · {l.invoice.invoice_number}</>}
                      </span>
                    </div>
                  </div>
                ))}
                {evidence.docs.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {evidence.docs.map(d => (
                      <a key={d.id} href={d.file_url} target="_blank" rel="noopener noreferrer"
                        className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" /> View invoice PDF
                      </a>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/60">
                  Read the <strong>UoM</strong> (e.g. "Bale of 10"), the <strong>description</strong> (e.g. "2kg") and the
                  <strong> unit price</strong> from the invoice, then enter the purchasing unit below. 1 Bale of 10 × 2kg = 20 {stockUom}.
                </p>
              </div>

              {/* Auto-pulled supplier evidence from the PDF (UoM / SKU / unit price). */}
              <SupplierEvidencePanel
                evidence={pdfEvidence}
                loading={evLoading}
                error={evError}
                stockUom={stockUom}
                onRetry={() => runAnalyze()}
              />

              {/* Purchasing unit editor — same fields as the review-queue match */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Purchase Unit Label *</Label>
                  <Input placeholder="e.g. Bale of 10 × 2kg" value={form.purchase_uom_label} onChange={e => set('purchase_uom_label', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Purchase UoM *</Label>
                  <UomSelect value={form.purchase_uom} onValueChange={v => set('purchase_uom', v)} placeholder="Select unit" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Conversion Factor * (1 {form.purchase_uom} = X {stockUom})</Label>
                  <Input type="number" step="any" placeholder={`e.g. 20`} value={form.conversion_factor} onChange={e => set('conversion_factor', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Yield Factor (default 1.0)</Label>
                  <Input type="number" step="0.001" value={form.yield_factor} onChange={e => set('yield_factor', e.target.value)} />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Unit Price / Nominal Cost (excl VAT, per {form.purchase_uom})</Label>
                <Input type="number" step="0.01" placeholder="e.g. 670.00" value={form.nominal_cost} onChange={e => set('nominal_cost', e.target.value)} />
              </div>

              {pricePerStock != null && (
                <div className="px-3 py-2 bg-primary/5 border border-primary/20 rounded-md text-sm">
                  <span className="text-muted-foreground">Price per {stockUom}: </span>
                  <span className="font-bold text-primary">{formatZAR(pricePerStock)}</span>
                  <span className="text-muted-foreground ml-1">(= {formatZAR(nc)} ÷ ({cf} × {yf}))</span>
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs">Supplier SKU</Label>
                <Input placeholder="Supplier's item code" value={form.supplier_sku} onChange={e => set('supplier_sku', e.target.value)} className="font-mono" />
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="flex-1 gap-2" onClick={handleSave} disabled={saving || !form}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save purchasing unit
          </Button>
        </div>
      </div>
    </div>
  );
}
