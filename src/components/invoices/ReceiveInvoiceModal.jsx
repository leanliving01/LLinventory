import React, { useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useUnsavedChanges, useGuardedAction } from '@/lib/navigationGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, PackageCheck, Search, AlertCircle, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { nextDocNumber } from '@/lib/docNumbering';
import { effectiveUnitCost } from '@/lib/utils';
import { confirmGRN } from '@/components/grn/GRNConfirmLogic';

/**
 * Create a blind receipt (GRN) straight from a supplier invoice — no PO.
 * Pre-fills product/qty/cost from the invoice lines; the user picks a delivery
 * location and maps any unmatched lines, then it receives stock and links the
 * GRN back to this invoice (invoice + GRN, no purchase order).
 */
export default function ReceiveInvoiceModal({ invoice, invoiceLines = [], onDone, onCancel }) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [locationId, setLocationId] = useState('');
  const [searchIdx, setSearchIdx] = useState(null);
  const [search, setSearch] = useState('');

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-stock'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 50),
  });
  const { data: products = [] } = useQuery({
    queryKey: ['active-products-receive'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 1000),
  });
  const { data: supplierProducts = [] } = useQuery({
    queryKey: ['sp-for-receive', invoice.supplier_id],
    queryFn: () => base44.entities.SupplierProduct.filter({ supplier_id: invoice.supplier_id, active: true }, 'product_name', 300),
    enabled: !!invoice.supplier_id,
  });

  // Un-allocated landed-cost charges on this invoice (shipping/freight…) — these
  // get capitalised across the received stock lines when the GRN is confirmed.
  const { data: charges = [] } = useQuery({
    queryKey: ['invoice-charges-receive', invoice.id],
    queryFn: () => base44.entities.PurchaseInvoiceCharge.filter({ invoice_id: invoice.id, allocated: false }, '-created_date', 50),
  });
  const chargesTotal = useMemo(() => charges.reduce((s, c) => s + (Number(c.amount) || 0), 0), [charges]);

  const spByProductId = useMemo(() => {
    const m = {};
    supplierProducts.forEach(sp => { m[sp.product_id] = sp; });
    return m;
  }, [supplierProducts]);

  // One editable row per invoice line, pre-filled.
  const [rows, setRows] = useState(() => invoiceLines.map(l => {
    const sp = l.product_id ? spByProductIdInit(supplierProducts, l.product_id) : null;
    return {
      key: l.id,
      product_id: l.product_id || '',
      supplier_product_id: l.supplier_product_id || sp?.id || '',
      label: l.product_name || l.xero_description || 'Line',
      qty: l.qty != null ? String(l.qty) : '',
      unit_cost: String(effectiveUnitCost(l) || ''),
      uom: l.unit || sp?.purchase_uom || '',
      conversion_factor: sp?.conversion_factor || 1,
    };
  }));

  // Baseline snapshot of the pre-filled rows so untouched rows don't read dirty.
  const initialRowsJson = useRef(JSON.stringify(rows)).current;

  const setRow = (i, patch) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const pickProduct = (i, productId) => {
    const p = products.find(pr => pr.id === productId);
    const sp = spByProductId[productId];
    setRow(i, {
      product_id: productId,
      supplier_product_id: sp?.id || '',
      label: p?.name || 'Product',
      uom: sp?.purchase_uom_label || sp?.purchase_uom || p?.stock_uom || rows[i].uom || '',
      conversion_factor: sp?.conversion_factor || 1,
      unit_cost: rows[i].unit_cost || String(sp?.last_purchase_price || p?.cost_avg || ''),
    });
    setSearchIdx(null);
    setSearch('');
  };

  const filteredProducts = useMemo(() => {
    if (!search) return products.slice(0, 20);
    const q = search.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)).slice(0, 20);
  }, [products, search]);

  const readyRows = rows.filter(r => r.product_id && Number(r.qty) > 0);
  const unmappedCount = rows.filter(r => !r.product_id).length;

  // Dirty when a delivery location is chosen or any pre-filled row was edited.
  const dirty = !saving && (!!locationId || JSON.stringify(rows) !== initialRowsJson);
  useUnsavedChanges(dirty, { message: 'You have an unreceived invoice in progress. Discard it?' });
  const guardedClose = useGuardedAction();

  const handleConfirm = async () => {
    if (!locationId) { toast.error('Select a delivery location'); return; }
    if (readyRows.length === 0) { toast.error('Map at least one line to a product with a quantity'); return; }

    setSaving(true);
    try {
      const grnNumber = await nextDocNumber('GRN');
      const today = new Date().toISOString().slice(0, 10);

      const grn = await base44.entities.GoodsReceivedNote.create({
        grn_number: grnNumber,
        supplier_id: invoice.supplier_id,
        supplier_name: invoice.supplier_name || '',
        location_id: locationId,
        invoice_id: invoice.id,
        status: 'draft',
        received_date: invoice.invoice_date || today,
        notes: `Blind receipt from invoice ${invoice.invoice_number}`,
      });

      const grnLines = readyRows.map(r => {
        const product = products.find(p => p.id === r.product_id);
        // Resolve the supplier product now (it may not have been loaded when the
        // row was first built) so the purchase→stock conversion is correct.
        const sp = spByProductId[r.product_id];
        const qty = Number(r.qty);
        return {
          grn_id: grn.id,
          product_id: r.product_id,
          product_name: product?.name || r.label,
          product_sku: product?.sku || '',
          supplier_product_id: r.supplier_product_id || sp?.id || null,
          expected_qty: qty,
          received_qty: qty,
          unit_cost: Number(r.unit_cost) || 0,
          purchase_uom: r.uom || sp?.purchase_uom || product?.stock_uom || '',
          conversion_factor: sp?.conversion_factor || Number(r.conversion_factor) || 1,
          yield_factor: 1,
          condition: 'accepted',
          item_type: 'stock',
        };
      });

      await confirmGRN(grn, grnLines, user?.full_name || user?.email || 'System', { charges });

      await base44.entities.PurchaseInvoice.update(invoice.id, {
        grn_id: grn.id,
        status: invoice.status === 'pending_match' ? 'matched' : invoice.status,
      });

      toast.success(`Received ${grnNumber} — stock updated`);
      onDone?.(grn);
    } catch (err) {
      console.error('[ReceiveInvoiceModal]', err);
      const msg = err?.validationErrors?.length ? err.validationErrors.join(' ') : (err.message || 'Unknown error');
      toast.error(`Failed: ${msg}`);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-2xl shadow-xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2">
              <PackageCheck className="w-5 h-5 text-primary" /> Receive Invoice (Blind Receipt)
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {invoice.supplier_name} · {invoice.invoice_number} — creates a GRN and receives stock, no PO.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => guardedClose(onCancel)}><X className="w-5 h-5" /></Button>
        </div>

        <div className="px-6 py-4 space-y-4 flex-1 overflow-y-auto">
          <div>
            <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Deliver To *</label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue placeholder="Select location…" /></SelectTrigger>
              <SelectContent>
                {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {unmappedCount > 0 && (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {unmappedCount} line(s) aren't mapped to a product yet — map them or they'll be skipped.
            </div>
          )}

          {chargesTotal > 0 && (
            <div className="flex items-start gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-2.5">
              <Truck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <span className="font-semibold">R {chargesTotal.toFixed(2)}</span> in additional charges
                ({charges.map(c => c.charge_type).join(', ')}) will be capitalised across the received
                lines <span className="font-medium">by value</span> — raising each unit's stock cost.
              </span>
            </div>
          )}

          <div className="border border-border rounded-lg divide-y divide-border">
            {rows.map((r, i) => (
              <div key={r.key} className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{r.label}</span>
                  {!r.product_id && <span className="text-[10px] text-amber-600 shrink-0">unmapped</span>}
                </div>

                {searchIdx === i ? (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input autoFocus placeholder="Search product…" value={search}
                      onChange={e => setSearch(e.target.value)} className="h-8 text-xs pl-8" />
                    <div className="absolute z-10 mt-1 w-full bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {filteredProducts.map(p => (
                        <button key={p.id} onClick={() => pickProduct(i, p.id)}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-primary/5">
                          {p.name} {p.sku && <span className="text-muted-foreground">· {p.sku}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="h-7 text-xs"
                    onClick={() => { setSearchIdx(i); setSearch(''); }}>
                    {r.product_id ? 'Change product' : 'Map product'}
                  </Button>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">Qty</label>
                    <Input type="number" step="any" value={r.qty} onChange={e => setRow(i, { qty: e.target.value })} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Unit ({r.uom || '—'})</label>
                    <Input value={r.uom} onChange={e => setRow(i, { uom: e.target.value })} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Unit Cost</label>
                    <Input type="number" step="0.01" value={r.unit_cost} onChange={e => setRow(i, { unit_cost: e.target.value })} className="h-8 text-xs" />
                  </div>
                </div>
                {r.product_id && (
                  <p className="text-[10px] text-muted-foreground">
                    1 {r.uom || 'unit'} = {r.conversion_factor} stock units · received into stock at this rate.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => guardedClose(onCancel)} disabled={saving}>Cancel</Button>
          <Button className="flex-1 gap-2" onClick={handleConfirm} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
            Receive {readyRows.length} line{readyRows.length !== 1 ? 's' : ''}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Helper used only for the initial row build (component-scope spByProductId isn't
// ready inside the useState initializer).
function spByProductIdInit(supplierProducts, productId) {
  return (supplierProducts || []).find(sp => sp.product_id === productId) || null;
}
