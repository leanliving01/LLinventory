import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, Plus, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import UomSelect from '@/components/shared/UomSelect';
import PurchasingUnitFields from '@/components/shared/PurchasingUnitFields';
import { effectiveUnitCost, formatZAR } from '@/lib/utils';
import { parsePack } from '@/lib/purchasingUnit';

const PRODUCT_TYPES = ['raw', 'packaging', 'supplement', 'service'];
const ITEM_TYPES = ['stock', 'non_stock', 'expense', 'service'];

/**
 * Creates a new Product AND SupplierProduct in one go from an unmatched invoice line.
 * Pre-fills fields from the Xero line data.
 */
export default function CreateProductFromLineModal({ line, invoice, invoicePdfUrl, onCreated, onCancel }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    // Product fields
    name: line.xero_description || '',
    sku: (line.xero_item_code || '').toUpperCase().replace(/\s+/g, '-') || '',
    type: 'raw',
    item_type: 'stock',
    stock_uom: 'kg',
    purchasable: true,
    // SupplierProduct fields — default the purchase unit to whatever the invoice
    // used (kg/head/bunch/case…) so a per-head item isn't silently created as kg.
    purchase_uom: (line.unit || 'kg').toLowerCase(),
    // Pack size parsed from the invoice description where possible.
    ...(() => {
      const pk = parsePack(`${line.unit || ''} ${line.xero_description || ''}`);
      return pk
        ? { pack_size: String(pk.packSize), pack_size_uom: pk.packSizeUom, pack_qty: String(pk.packQty) }
        : { pack_size: '', pack_size_uom: '', pack_qty: '1' };
    })(),
    conversion_factor: 1,
    yield_factor: 1,
    xero_item_code: line.xero_item_code || '',
    // Effective per-unit price (repairs legacy rows that stored the line total).
    last_purchase_price: effectiveUnitCost(line) || 0,
  });
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error('Enter a product name'); return; }
    if (!form.sku.trim()) { toast.error('Enter a SKU'); return; }
    setSaving(true);

    try {
      // 1. Create Product
      const product = await base44.entities.Product.create({
        name: form.name.trim(),
        sku: form.sku.trim(),
        type: form.type,
        item_type: form.item_type,
        stock_uom: form.stock_uom,
        purchasable: form.purchasable,
        status: 'active',
        cost_current: parseFloat(form.last_purchase_price) || 0,
      });

      // 2. Create SupplierProduct
      const cf = parseFloat(form.conversion_factor) || 1;
      const yf = parseFloat(form.yield_factor) || 1;
      const sp = await base44.entities.SupplierProduct.create({
        supplier_id: invoice.supplier_id,
        supplier_name: invoice.supplier_name,
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku,
        xero_item_code: form.xero_item_code,
        supplier_sku: form.xero_item_code || '',   // the supplier's item code IS the supplier SKU
        supplier_description: line.xero_description || '',
        purchase_uom: form.purchase_uom,
        purchase_uom_label: form.purchase_uom,
        purchase_uom_name: form.purchase_uom,
        purchase_uom_qty: 1,
        pack_size: form.pack_size !== '' && form.pack_size != null ? parseFloat(form.pack_size) : null,
        pack_size_uom: form.pack_size_uom || null,
        pack_qty: form.pack_qty !== '' && form.pack_qty != null ? parseFloat(form.pack_qty) : 1,
        conversion_uom: form.stock_uom,
        conversion_factor: cf,
        yield_factor: yf,
        effective_internal_qty: Math.round(cf * yf * 1000) / 1000,
        last_purchase_price: parseFloat(form.last_purchase_price) || 0,
        is_default_supplier: true,
        active: true,
      });

      toast.success(`Created product "${product.name}" and linked to ${invoice.supplier_name}`);
      // Only hand back to the parent (which closes the modal) on a clean save.
      onCreated(line, sp, product);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" /> Create Product
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              <span>From: {line.xero_description?.substring(0, 50)}</span>
              {invoice?.invoice_number && (
                invoicePdfUrl ? (
                  <a href={invoicePdfUrl} target="_blank" rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1 font-mono"
                    title="Open the supplier invoice PDF">
                    {invoice.invoice_number} <ExternalLink className="w-3 h-3" />
                  </a>
                ) : <span className="font-mono">{invoice.invoice_number}</span>
              )}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Product details */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Product Details</h4>
            <div>
              <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Name *</label>
              <Input value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">SKU *</label>
                <Input value={form.sku} onChange={e => set('sku', e.target.value)} className="font-mono" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Type</label>
                <Select value={form.type} onValueChange={v => set('type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRODUCT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Item Type</label>
                <Select value={form.item_type} onValueChange={v => set('item_type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ITEM_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Stock UoM</label>
                <UomSelect value={form.stock_uom} onValueChange={v => set('stock_uom', v)} placeholder="Select unit" />
              </div>
            </div>
          </div>

          {/* Supplier product details */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Supplier Link — {invoice.supplier_name}</h4>
            {line.unit && (
              <p className="text-[11px] text-muted-foreground bg-muted/40 rounded px-2 py-1.5">
                Invoiced in <span className="font-medium">{line.unit}</span> at {formatZAR(effectiveUnitCost(line) || 0)}/{line.unit}.
                If 1 {form.purchase_uom || line.unit} ≠ 1 {form.stock_uom}, set the conversion factor below
                (1 {form.purchase_uom || line.unit} = how many {form.stock_uom}).
              </p>
            )}
            {/* Purchase UOM + pack size → auto conversion */}
            <PurchasingUnitFields form={form} set={set} stockUom={form.stock_uom} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Yield Factor</label>
                <Input type="number" step="0.01" min="0" max="1" value={form.yield_factor} onChange={e => set('yield_factor', e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Last Price (R)</label>
                <Input type="number" step="0.01" value={form.last_purchase_price} onChange={e => set('last_purchase_price', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Xero Item Code</label>
              <Input value={form.xero_item_code} onChange={e => set('xero_item_code', e.target.value)} className="font-mono" />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1 gap-2" onClick={handleCreate} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {saving ? 'Creating...' : 'Create & Match'}
          </Button>
        </div>
      </div>
    </div>
  );
}