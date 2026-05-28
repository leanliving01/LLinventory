import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, Link2, Search } from 'lucide-react';
import { toast } from 'sonner';

const PURCHASE_UOMS = ['case', 'bag', 'drum', 'pallet', 'box', 'each', 'kg', 'L'];

export default function CreateSupplierProductModal({ preselectedSupplierId, onCreated, onCancel }) {
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [form, setForm] = useState({
    supplier_id: preselectedSupplierId || '',
    product_id: '',
    supplier_sku: '',
    supplier_description: '',
    xero_item_code: '',
    purchase_uom: 'kg',
    purchase_uom_qty: 1,
    purchase_uom_label: '',
    conversion_factor: 1,
    conversion_uom: '',
    yield_factor: 1,
    last_purchase_price: 0,
    lead_time_days: 1,
    min_order_qty: 0,
    is_default_supplier: false,
  });

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => base44.entities.Supplier.filter({ status: 'active' }, 'name', 200),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-purchasable'],
    queryFn: () => base44.entities.Product.filter({ status: 'active', purchasable: true }, 'name', 500),
  });

  const filteredProducts = useMemo(() => {
    if (!productSearch) return products.slice(0, 15);
    const q = productSearch.toLowerCase();
    return products.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    ).slice(0, 15);
  }, [products, productSearch]);

  const selectedProduct = products.find(p => p.id === form.product_id);
  const selectedSupplier = suppliers.find(s => s.id === form.supplier_id);

  const handleCreate = async () => {
    if (!form.supplier_id || !form.product_id) {
      toast.error('Select both a supplier and a product');
      return;
    }
    setSaving(true);

    try {
      const cf = parseFloat(form.conversion_factor) || 1;
      const yf = parseFloat(form.yield_factor) || 1;
      const data = {
        ...form,
        supplier_name: selectedSupplier?.name || '',
        product_name: selectedProduct?.name || '',
        product_sku: selectedProduct?.sku || '',
        conversion_factor: cf,
        yield_factor: yf,
        conversion_uom: form.conversion_uom || selectedProduct?.stock_uom || '',
        effective_internal_qty: Math.round(cf * yf * 1000) / 1000,
        purchase_uom_qty: parseFloat(form.purchase_uom_qty) || 1,
        last_purchase_price: parseFloat(form.last_purchase_price) || 0,
        min_order_qty: parseFloat(form.min_order_qty) || 0,
        lead_time_days: parseInt(form.lead_time_days) || 1,
        active: true,
      };
      await base44.entities.SupplierProduct.create(data);
      toast.success('Supplier product link created');
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }

    onCreated();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">Link Supplier Product</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Supplier */}
          {!preselectedSupplierId && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier *</label>
              <Select value={form.supplier_id} onValueChange={v => set('supplier_id', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Product search */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Internal Product *</label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or SKU..."
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {!form.product_id && (
              <div className="border border-border rounded-lg mt-1 max-h-40 overflow-y-auto">
                {filteredProducts.map(p => (
                  <button
                    key={p.id}
                    onClick={() => {
                      set('product_id', p.id);
                      set('conversion_uom', p.stock_uom || '');
                      setProductSearch(p.name);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex justify-between"
                  >
                    <span>{p.name}</span>
                    <span className="text-xs font-mono text-muted-foreground">{p.sku} · {p.stock_uom}</span>
                  </button>
                ))}
                {filteredProducts.length === 0 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No products found</p>
                )}
              </div>
            )}
            {selectedProduct && (
              <div className="flex items-center gap-2 mt-1 bg-primary/5 rounded-lg px-3 py-2">
                <span className="text-sm font-medium">{selectedProduct.name}</span>
                <span className="text-xs font-mono text-muted-foreground">{selectedProduct.sku} · {selectedProduct.stock_uom}</span>
                <Button variant="ghost" size="icon" className="ml-auto w-6 h-6" onClick={() => { set('product_id', ''); setProductSearch(''); }}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* Supplier SKU & description */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier SKU</label>
              <Input value={form.supplier_sku} onChange={e => set('supplier_sku', e.target.value)} className="mt-1" placeholder="SUP-001" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Xero Item Code</label>
              <Input value={form.xero_item_code} onChange={e => set('xero_item_code', e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier Description</label>
            <Input value={form.supplier_description} onChange={e => set('supplier_description', e.target.value)} className="mt-1" placeholder="How it appears on invoice" />
          </div>

          {/* UoM */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Purchase UoM</label>
              <Select value={form.purchase_uom} onValueChange={v => set('purchase_uom', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PURCHASE_UOMS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">UoM Qty</label>
              <Input type="number" value={form.purchase_uom_qty} onChange={e => set('purchase_uom_qty', e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Conversion Factor</label>
              <Input type="number" step="0.01" value={form.conversion_factor} onChange={e => set('conversion_factor', e.target.value)} className="mt-1" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">UoM Label (e.g. Case of 6 × 1kg)</label>
            <Input value={form.purchase_uom_label} onChange={e => set('purchase_uom_label', e.target.value)} className="mt-1" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Yield Factor</label>
              <Input type="number" step="0.01" min="0" max="1" value={form.yield_factor} onChange={e => set('yield_factor', e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Last Price (ZAR)</label>
              <Input type="number" step="0.01" value={form.last_purchase_price} onChange={e => set('last_purchase_price', e.target.value)} className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Lead Time (days)</label>
              <Input type="number" value={form.lead_time_days} onChange={e => set('lead_time_days', e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Min Order Qty</label>
              <Input type="number" value={form.min_order_qty} onChange={e => set('min_order_qty', e.target.value)} className="mt-1" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.is_default_supplier} onChange={e => set('is_default_supplier', e.target.checked)} className="rounded" />
            Set as default supplier for this product
          </label>
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3 sticky bottom-0 bg-card">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1 gap-2" onClick={handleCreate} disabled={saving || !form.supplier_id || !form.product_id}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            {saving ? 'Creating...' : 'Create Link'}
          </Button>
        </div>
      </div>
    </div>
  );
}