import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Star, Truck, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import SupplierProductDrawer from '@/components/purchasing/SupplierProductDrawer';

const PURCHASE_UOMS = ['case', 'bag', 'drum', 'pallet', 'box', 'each', 'kg', 'L'];

export default function ProductSuppliersTab({ productId, productName, productSku, stockUom, canEdit }) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [drawerSP, setDrawerSP] = useState(null);

  const { data: supplierProducts = [], isLoading } = useQuery({
    queryKey: ['product-supplier-products', productId],
    queryFn: () => base44.entities.SupplierProduct.filter({ product_id: productId }, '-is_default_supplier', 50),
    enabled: !!productId,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => base44.entities.Supplier.filter({ status: 'active' }, 'name', 200),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['product-supplier-products', productId] });
  };

  const handleSetDefault = async (spId) => {
    // Unset all others, set this one
    for (const sp of supplierProducts) {
      if (sp.id === spId) {
        await base44.entities.SupplierProduct.update(sp.id, { is_default_supplier: true });
      } else if (sp.is_default_supplier) {
        await base44.entities.SupplierProduct.update(sp.id, { is_default_supplier: false });
      }
    }
    invalidate();
    toast.success('Default supplier updated');
  };

  const handleDelete = async (spId) => {
    await base44.entities.SupplierProduct.delete(spId);
    invalidate();
    toast.success('Supplier link removed');
  };

  const defaultSP = supplierProducts.find(sp => sp.is_default_supplier);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Truck className="w-4 h-4 text-primary" /> Suppliers
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {supplierProducts.length} supplier{supplierProducts.length !== 1 ? 's' : ''} linked
            {defaultSP && <> · Default: <strong>{defaultSP.supplier_name}</strong></>}
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add Supplier
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-sm text-muted-foreground">Loading...</div>
      ) : supplierProducts.length === 0 ? (
        <div className="text-center py-8 bg-muted/30 border border-border rounded-xl">
          <Truck className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No suppliers linked to this product yet.</p>
          {canEdit && (
            <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => setShowAdd(true)}>
              <Plus className="w-3.5 h-3.5" /> Add First Supplier
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Supplier</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Supplier SKU</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Purchase UoM</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Conversion</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Last Price</th>
                <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Default</th>
                {canEdit && <th className="w-10"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {supplierProducts.map(sp => (
                <tr
                  key={sp.id}
                  className="hover:bg-muted/20 transition-colors cursor-pointer"
                  onClick={() => setDrawerSP(sp)}
                >
                  <td className="px-4 py-2.5">
                    <p className="text-sm font-medium">{sp.supplier_name}</p>
                    {sp.supplier_description && (
                      <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">{sp.supplier_description}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{sp.supplier_sku || '—'}</td>
                  <td className="px-4 py-2.5 text-xs">{sp.purchase_uom_label || sp.purchase_uom || '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-right tabular-nums">
                    1 = {sp.conversion_factor || 1} {sp.conversion_uom || stockUom || ''}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-right tabular-nums font-medium">
                    R {(sp.last_purchase_price || 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                    {sp.is_default_supplier ? (
                      <Star className="w-4 h-4 text-amber-500 fill-amber-500 mx-auto" />
                    ) : canEdit ? (
                      <button
                        onClick={() => handleSetDefault(sp.id)}
                        className="text-xs text-muted-foreground hover:text-primary transition-colors"
                      >
                        Set default
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(sp.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddSupplierForm
          productId={productId}
          productName={productName}
          productSku={productSku}
          stockUom={stockUom}
          suppliers={suppliers}
          existingSupplierIds={supplierProducts.map(sp => sp.supplier_id)}
          onCreated={() => { setShowAdd(false); invalidate(); }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {drawerSP && (
        <SupplierProductDrawer
          sp={drawerSP}
          onClose={() => setDrawerSP(null)}
          onUpdated={() => { setDrawerSP(null); invalidate(); }}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}

function AddSupplierForm({ productId, productName, productSku, stockUom, suppliers, existingSupplierIds, onCreated, onCancel }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    supplier_id: '',
    supplier_sku: '',
    supplier_description: '',
    purchase_uom: 'kg',
    purchase_uom_label: '',
    conversion_factor: 1,
    last_purchase_price: 0,
    is_default_supplier: false,
  });
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const availableSuppliers = suppliers.filter(s => !existingSupplierIds.includes(s.id));
  const selectedSupplier = suppliers.find(s => s.id === form.supplier_id);

  const handleSave = async () => {
    if (!form.supplier_id) { toast.error('Select a supplier'); return; }
    setSaving(true);
    const cf = parseFloat(form.conversion_factor) || 1;
    await base44.entities.SupplierProduct.create({
      supplier_id: form.supplier_id,
      supplier_name: selectedSupplier?.name || '',
      product_id: productId,
      product_name: productName,
      product_sku: productSku,
      supplier_sku: form.supplier_sku,
      supplier_description: form.supplier_description,
      purchase_uom: form.purchase_uom,
      purchase_uom_label: form.purchase_uom_label,
      conversion_factor: cf,
      conversion_uom: stockUom || 'kg',
      yield_factor: 1.0,
      effective_internal_qty: cf,
      last_purchase_price: parseFloat(form.last_purchase_price) || 0,
      is_default_supplier: form.is_default_supplier,
      active: true,
    });
    toast.success('Supplier linked');
    setSaving(false);
    onCreated();
  };

  return (
    <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-3">
      <h4 className="text-sm font-semibold">Link New Supplier</h4>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] uppercase text-muted-foreground font-semibold">Supplier *</label>
          <Select value={form.supplier_id} onValueChange={v => set('supplier_id', v)}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent>
              {availableSuppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[10px] uppercase text-muted-foreground font-semibold">Supplier SKU</label>
          <Input value={form.supplier_sku} onChange={e => set('supplier_sku', e.target.value)} className="mt-1" placeholder="Their code" />
        </div>
      </div>
      <div>
        <label className="text-[10px] uppercase text-muted-foreground font-semibold">Supplier Description (how they name it)</label>
        <Input value={form.supplier_description} onChange={e => set('supplier_description', e.target.value)} className="mt-1" placeholder="e.g. Chicken Breast Fillet Bulk 10kg" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] uppercase text-muted-foreground font-semibold">Purchase UoM</label>
          <Select value={form.purchase_uom} onValueChange={v => set('purchase_uom', v)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PURCHASE_UOMS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[10px] uppercase text-muted-foreground font-semibold">UoM Label</label>
          <Input value={form.purchase_uom_label} onChange={e => set('purchase_uom_label', e.target.value)} className="mt-1" placeholder="e.g. Box of 10kg" />
        </div>
        <div>
          <label className="text-[10px] uppercase text-muted-foreground font-semibold">1 unit = X {stockUom || 'kg'}</label>
          <Input type="number" step="0.01" value={form.conversion_factor} onChange={e => set('conversion_factor', e.target.value)} className="mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] uppercase text-muted-foreground font-semibold">Last Price (ZAR per unit)</label>
          <Input type="number" step="0.01" value={form.last_purchase_price} onChange={e => set('last_purchase_price', e.target.value)} className="mt-1" />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
            <input type="checkbox" checked={form.is_default_supplier} onChange={e => set('is_default_supplier', e.target.checked)} className="rounded" />
            Default supplier
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Link Supplier
        </Button>
      </div>
    </div>
  );
}