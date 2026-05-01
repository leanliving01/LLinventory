import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

const PRODUCT_TYPES = ['raw', 'packaging', 'supplement', 'service'];
const ITEM_TYPES = ['stock', 'non_stock', 'expense', 'service'];
const STOCK_UOMS = ['g', 'kg', 'ml', 'L', 'pcs', 'box'];
const PURCHASE_UOMS = ['case', 'bag', 'drum', 'pallet', 'box', 'each', 'kg', 'L'];

/**
 * Creates a new Product AND SupplierProduct in one go from an unmatched invoice line.
 * Pre-fills fields from the Xero line data.
 */
export default function CreateProductFromLineModal({ line, invoice, onCreated, onCancel }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    // Product fields
    name: line.xero_description || '',
    sku: (line.xero_item_code || '').toUpperCase().replace(/\s+/g, '-') || '',
    type: 'raw',
    item_type: 'stock',
    stock_uom: 'kg',
    purchasable: true,
    // SupplierProduct fields
    purchase_uom: 'kg',
    conversion_factor: 1,
    yield_factor: 1,
    xero_item_code: line.xero_item_code || '',
    last_purchase_price: line.unit_cost || 0,
  });
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error('Enter a product name'); return; }
    if (!form.sku.trim()) { toast.error('Enter a SKU'); return; }
    setSaving(true);

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
      supplier_description: line.xero_description || '',
      purchase_uom: form.purchase_uom,
      purchase_uom_qty: 1,
      conversion_uom: form.stock_uom,
      conversion_factor: cf,
      yield_factor: yf,
      effective_internal_qty: Math.round(cf * yf * 1000) / 1000,
      last_purchase_price: parseFloat(form.last_purchase_price) || 0,
      is_default_supplier: true,
      active: true,
    });

    toast.success(`Created product "${product.name}" and linked to ${invoice.supplier_name}`);
    setSaving(false);
    onCreated(line, sp, product);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" /> Create Product
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              From: {line.xero_description?.substring(0, 50)}
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
                <Select value={form.stock_uom} onValueChange={v => set('stock_uom', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STOCK_UOMS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Supplier product details */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Supplier Link — {invoice.supplier_name}</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Purchase UoM</label>
                <Select value={form.purchase_uom} onValueChange={v => set('purchase_uom', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PURCHASE_UOMS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Conversion Factor</label>
                <Input type="number" step="0.01" value={form.conversion_factor} onChange={e => set('conversion_factor', e.target.value)} />
              </div>
            </div>
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