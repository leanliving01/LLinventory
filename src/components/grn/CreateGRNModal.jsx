import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, PackageCheck, Search, Check, ChevronsUpDown, FileText, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { nextDocNumber } from '@/lib/docNumbering';
import { useUnsavedChanges, useGuardedAction } from '@/lib/navigationGuard';

/**
 * Type-ahead supplier picker. Renders an inline (non-portal) dropdown so it
 * never collides with the modal's own stacking context. Filters the active
 * supplier list as you type; clicking a row selects it.
 */
function SupplierCombobox({ suppliers, value, onChange, autoFocus }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const selected = suppliers.find(s => s.id === value);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? suppliers.filter(s => (s.name || '').toLowerCase().includes(q))
      : suppliers;
    return list.slice(0, 50);
  }, [suppliers, query]);

  // When the field is open the input reflects the live search text; when closed
  // it shows the selected supplier's name.
  const displayValue = open ? query : (selected?.name || '');

  return (
    <div className="relative mt-1" ref={wrapRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          value={displayValue}
          placeholder="Search or select supplier..."
          autoFocus={autoFocus}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          className="pl-9 pr-9"
        />
        <ChevronsUpDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      </div>

      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">No suppliers found</div>
          ) : (
            filtered.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => { onChange(s.id); setQuery(''); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-muted/50 transition-colors ${
                  s.id === value ? 'bg-primary/5 font-medium' : ''
                }`}
              >
                <span className="truncate">{s.name}</span>
                {s.id === value && <Check className="w-4 h-4 text-primary shrink-0 ml-2" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function CreateGRNModal({ onCreated, onCancel }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    supplier_id: '',
    location_id: '',
    purchase_order_id: '',
    invoice_id: '',
    received_date: format(new Date(), 'yyyy-MM-dd'),
    notes: '',
  });
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => base44.entities.Supplier.filter({ status: 'active' }, 'name', 500),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 50),
  });

  // Outstanding supplier invoices = invoices for this supplier not yet received
  // (no GRN linked). These are what the user receives goods against.
  const { data: outstandingInvoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ['outstanding-invoices-for-grn', form.supplier_id],
    queryFn: () => form.supplier_id
      ? base44.entities.PurchaseInvoice.filter({ supplier_id: form.supplier_id }, '-invoice_date', 100)
        .then(all => all.filter(inv => !inv.grn_id))
      : Promise.resolve([]),
    enabled: !!form.supplier_id,
  });

  // Open POs for the selected supplier — only offered when not receiving against
  // an invoice (the invoice already defines the lines to receive).
  const { data: openPOs = [] } = useQuery({
    queryKey: ['open-pos-for-grn', form.supplier_id],
    queryFn: () => form.supplier_id
      ? base44.entities.PurchaseOrder.filter({ supplier_id: form.supplier_id }, '-created_date', 50)
        .then(all => all.filter(po => ['approved', 'draft', 'awaiting_approval', 'partially_received'].includes(po.status)))
      : Promise.resolve([]),
    enabled: !!form.supplier_id,
  });

  const selectedSupplier = suppliers.find(s => s.id === form.supplier_id);
  const selectedLocation = locations.find(l => l.id === form.location_id);
  const selectedInvoice = outstandingInvoices.find(i => i.id === form.invoice_id);

  const onSupplierChange = (supplierId) => {
    setForm(prev => ({ ...prev, supplier_id: supplierId, purchase_order_id: '', invoice_id: '' }));
  };

  // Unsaved-changes guard: dirty once any picker/field is set. received_date
  // defaults to today, so it doesn't count as an edit on its own.
  const dirty =
    !!form.supplier_id ||
    !!form.location_id ||
    !!form.purchase_order_id ||
    !!form.invoice_id ||
    !!form.notes;
  useUnsavedChanges(dirty, { message: 'This goods received note has unsaved changes.' });
  const guardedClose = useGuardedAction();

  const handleCreate = async () => {
    if (!form.supplier_id) { toast.error('Select a supplier'); return; }
    if (!form.location_id) { toast.error('Select a receiving location'); return; }
    setSaving(true);

    // Step 1 — create the GRN. This is the only fatal step; if it fails we stay
    // in the modal so the user can retry without orphaning anything.
    let grn;
    try {
      const grnNumber = await nextDocNumber('GRN');
      grn = await base44.entities.GoodsReceivedNote.create({
        grn_number: grnNumber,
        supplier_id: form.supplier_id,
        supplier_name: selectedSupplier?.name || '',
        location_id: form.location_id,
        location_name: selectedLocation?.name || '',
        purchase_order_id: form.purchase_order_id || undefined,
        invoice_id: selectedInvoice?.id || undefined,
        received_date: form.received_date,
        status: 'draft',
        notes: form.notes,
      });
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
      setSaving(false);
      return;
    }

    // Step 2 — pre-populate lines / claim the invoice. Non-fatal: the GRN already
    // exists and is fully editable, so a hiccup here still opens the GRN.
    try {
      if (selectedInvoice) {
        // Receiving against an invoice — pre-populate GRN lines from invoice lines.
        const [invLines, sps] = await Promise.all([
          base44.entities.PurchaseInvoiceLine.filter({ invoice_id: selectedInvoice.id }, 'product_name', 200),
          base44.entities.SupplierProduct.filter({ supplier_id: form.supplier_id, active: true }, 'product_name', 300),
        ]);
        const spById = {};
        const spByProduct = {};
        sps.forEach(sp => { spById[sp.id] = sp; spByProduct[sp.product_id] = sp; });

        // Only lines mapped to a product can be received as stock.
        const receivable = invLines.filter(l => l.product_id);
        const skipped = invLines.length - receivable.length;

        const grnLines = receivable.map(il => {
          const sp = il.supplier_product_id ? spById[il.supplier_product_id] : spByProduct[il.product_id];
          const qty = Number(il.qty) || 0;
          const unitCost = Number(il.unit_cost) || sp?.last_purchase_price || 0;
          const cf = sp?.conversion_factor || sp?.purchase_to_stock_factor || 1;
          const yf = sp?.yield_factor || 1;
          return {
            grn_id: grn.id,
            supplier_product_id: sp?.id || il.supplier_product_id || null,
            product_id: il.product_id,
            product_name: il.product_name || '',
            product_sku: il.product_sku || '',
            expected_qty: qty,
            received_qty: qty, // pre-fill with invoiced qty; receiver adjusts to actual
            variance_qty: 0,
            purchase_uom: il.unit || sp?.purchase_uom_label || sp?.purchase_uom || '',
            conversion_factor: cf,
            yield_factor: yf,
            unit_cost: unitCost,
            line_total: Math.round(qty * unitCost * 100) / 100,
            condition: 'accepted',
            item_type: 'stock',
          };
        });

        if (grnLines.length > 0) {
          await base44.entities.GRNLine.bulkCreate(grnLines);
          await base44.entities.GoodsReceivedNote.update(grn.id, { total_lines: grnLines.length });
        }

        // Claim the invoice so it drops out of the outstanding list.
        await base44.entities.PurchaseInvoice.update(selectedInvoice.id, { grn_id: grn.id });

        if (skipped > 0) {
          toast.warning(`${skipped} invoice line${skipped !== 1 ? 's' : ''} not mapped to a product — add ${skipped !== 1 ? 'them' : 'it'} manually in the GRN.`);
        }
        if (grnLines.length === 0) {
          toast.info('Invoice has no mapped product lines — add the received products in the GRN.');
        }
      } else if (form.purchase_order_id) {
        // Receiving against a PO — pre-populate GRN lines from PO lines.
        const poLines = await base44.entities.PurchaseOrderLine.filter(
          { purchase_order_id: form.purchase_order_id }, 'product_name', 100
        );
        if (poLines.length > 0) {
          const sps = await base44.entities.SupplierProduct.filter(
            { supplier_id: form.supplier_id, active: true }, 'product_name', 200
          );
          const spMap = {};
          sps.forEach(sp => { spMap[sp.product_id] = sp; });

          const grnLines = poLines.map(pl => {
            const sp = pl.supplier_product_id ? sps.find(s => s.id === pl.supplier_product_id) : spMap[pl.product_id];
            return {
              grn_id: grn.id,
              po_line_id: pl.id,
              supplier_product_id: sp?.id || pl.supplier_product_id || null,
              product_id: pl.product_id,
              product_name: pl.product_name || '',
              product_sku: pl.product_sku || '',
              expected_qty: pl.ordered_qty || 0,
              received_qty: pl.ordered_qty || 0, // Pre-fill with expected
              variance_qty: 0,
              purchase_uom: sp?.purchase_uom || pl.purchase_uom || pl.uom || '',
              conversion_factor: sp?.conversion_factor || 1,
              yield_factor: sp?.yield_factor || 1,
              unit_cost: pl.unit_cost || sp?.last_purchase_price || 0,
              line_total: (pl.ordered_qty || 0) * (pl.unit_cost || 0),
              condition: 'accepted',
              item_type: 'stock',
            };
          });
          await base44.entities.GRNLine.bulkCreate(grnLines);
          await base44.entities.GoodsReceivedNote.update(grn.id, { total_lines: grnLines.length });
        }
      }

      toast.success(`GRN ${grn.grn_number} created`);
    } catch (err) {
      console.warn('[CreateGRNModal] line pre-population failed:', err?.message);
      toast.warning(`GRN created, but its lines couldn't be pre-filled — add them in the GRN.`);
    }

    setSaving(false);
    onCreated(grn);
  };

  const fmtMoney = (n) => `R ${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">New Goods Received Note</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={() => guardedClose(onCancel)}><X className="w-5 h-5" /></Button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier *</label>
            <SupplierCombobox
              suppliers={suppliers}
              value={form.supplier_id}
              onChange={onSupplierChange}
              autoFocus
            />
          </div>

          {/* Outstanding invoices for the selected supplier */}
          {form.supplier_id && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Outstanding Invoices
              </label>
              {invoicesLoading ? (
                <div className="mt-1 text-sm text-muted-foreground flex items-center gap-2 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading invoices...
                </div>
              ) : outstandingInvoices.length === 0 ? (
                <div className="mt-1 flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>No outstanding invoices for this supplier. Receive against a PO below, or create a blind receipt (no invoice/PO).</span>
                </div>
              ) : (
                <div className="mt-1 space-y-1.5 max-h-52 overflow-y-auto">
                  {outstandingInvoices.map(inv => {
                    const isSel = inv.id === form.invoice_id;
                    return (
                      <button
                        key={inv.id}
                        type="button"
                        onClick={() => setForm(prev => ({
                          ...prev,
                          invoice_id: isSel ? '' : inv.id,
                          purchase_order_id: '',
                        }))}
                        className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                          isSel ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border hover:bg-muted/30'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-semibold truncate">{inv.invoice_number}</span>
                              {isSel && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {inv.invoice_date || 'No date'}
                              {inv.due_date ? ` · due ${inv.due_date}` : ''}
                            </div>
                          </div>
                          <div className="text-sm font-medium whitespace-nowrap">{fmtMoney(inv.total)}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Receive Into *</label>
            <Select value={form.location_id} onValueChange={v => set('location_id', v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select location" /></SelectTrigger>
              <SelectContent>
                {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* PO link is only an alternative when NOT receiving against an invoice */}
          {!selectedInvoice && openPOs.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Link to PO (optional)</label>
              <Select value={form.purchase_order_id} onValueChange={v => set('purchase_order_id', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Blind receipt (no PO)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Blind receipt (no PO)</SelectItem>
                  {openPOs.map(po => (
                    <SelectItem key={po.id} value={po.id}>
                      {po.po_number} — R {(po.total || 0).toFixed(2)} ({po.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Received Date</label>
            <Input type="date" value={form.received_date} onChange={e => set('received_date', e.target.value)} className="mt-1" />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Notes</label>
            <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} className="mt-1 h-16" placeholder="Delivery note number, driver name, etc." />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3 shrink-0">
          <Button variant="outline" className="flex-1" onClick={() => guardedClose(onCancel)}>Cancel</Button>
          <Button className="flex-1 gap-2" onClick={handleCreate} disabled={saving || !form.supplier_id || !form.location_id}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
            {saving ? 'Creating...' : selectedInvoice ? 'Receive Against Invoice' : 'Create GRN'}
          </Button>
        </div>
      </div>
    </div>
  );
}
