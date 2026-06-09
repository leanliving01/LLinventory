import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Loader2, Pencil, Check, X as XIcon, Star } from 'lucide-react';
import { toast } from 'sonner';
import { formatZAR } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import UomSelect from '@/components/shared/UomSelect';

const EMPTY_ROW = {
  purchase_uom_label: '',
  purchase_uom: 'kg',
  supplier_id: '',
  conversion_factor: '',
  yield_factor: '1',
  nominal_cost: '',
  supplier_sku: '',
  supplier_description: '',
  is_default: false,
};

function UomForm({ row, onChange, activeSuppliers, stockUom, onSave, onCancel, saving }) {
  const cf = parseFloat(row.conversion_factor);
  const yf = parseFloat(row.yield_factor) || 1;
  const nc = parseFloat(row.nominal_cost);
  const pricePerStock = cf > 0 && nc >= 0 && yf > 0 ? nc / (cf * yf) : null;

  return (
    <div className="border border-dashed border-primary/40 rounded-lg p-4 space-y-3 bg-primary/5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Purchase Unit Label *</Label>
          <Input
            placeholder="e.g. 25kg Bag, Case of 6, 25L Drum"
            value={row.purchase_uom_label}
            onChange={e => onChange('purchase_uom_label', e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Purchase UoM *</Label>
          <UomSelect value={row.purchase_uom || 'kg'} onValueChange={v => onChange('purchase_uom', v)} placeholder="Select UoM" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Supplier *</Label>
        <Select value={row.supplier_id || 'none'} onValueChange={v => onChange('supplier_id', v === 'none' ? '' : v)}>
          <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Select supplier —</SelectItem>
            {activeSuppliers.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeSuppliers.length === 0 && (
          <p className="text-[10px] text-amber-600">No active suppliers yet — add a supplier first.</p>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Conversion Factor * (1 purchase unit = X {stockUom || 'stock units'})</Label>
          <Input
            type="number"
            placeholder={`e.g. 25 (if 1 bag = 25 ${stockUom || 'units'})`}
            value={row.conversion_factor}
            onChange={e => onChange('conversion_factor', e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Yield Factor (default 1.0)</Label>
          <Input
            type="number"
            step="0.001"
            placeholder="e.g. 0.95 for 5% waste"
            value={row.yield_factor}
            onChange={e => onChange('yield_factor', e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Nominal Cost (excl VAT) *</Label>
          <Input
            type="number"
            step="0.01"
            placeholder="e.g. 450.00"
            value={row.nominal_cost}
            onChange={e => onChange('nominal_cost', e.target.value)}
          />
        </div>
        {row.last_purchase_price != null && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Last GRN price — auto-updated</Label>
            <Input
              type="number"
              value={row.last_purchase_price ?? ''}
              readOnly
              disabled
              className="bg-muted text-muted-foreground cursor-not-allowed"
            />
          </div>
        )}
      </div>

      {/* Computed price per stock UOM */}
      {pricePerStock != null && (
        <div className="px-3 py-2 bg-background rounded-md border border-border text-sm">
          <span className="text-muted-foreground">Price per {stockUom || 'stock unit'}: </span>
          <span className="font-semibold text-foreground">{formatZAR(pricePerStock)}</span>
          <span className="text-muted-foreground ml-1">
            (= {formatZAR(nc)} ÷ ({cf} × {yf}))
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Supplier SKU</Label>
          <Input
            placeholder="Supplier's product code"
            value={row.supplier_sku}
            onChange={e => onChange('supplier_sku', e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Supplier Description</Label>
          <Input
            placeholder="Supplier's name for this product"
            value={row.supplier_description}
            onChange={e => onChange('supplier_description', e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={onSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

export default function ProductPurchaseUomEditor({ productId, product, stockUom }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [newRow, setNewRow] = useState(EMPTY_ROW);
  const [editRow, setEditRow] = useState(null);

  const { data: supplierProducts = [], isLoading } = useQuery({
    queryKey: ['product-supplier-products', productId],
    queryFn: () => base44.entities.SupplierProduct.filter({ product_id: productId }),
    enabled: !!productId,
  });

  // Fetch active suppliers only
  const { data: allSuppliers = [] } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => base44.entities.Supplier.filter({ status: 'active' }, 'name', 200),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['product-supplier-products', productId] });

  const buildPayload = (row) => {
    const cf = parseFloat(row.conversion_factor) || 1;
    const yf = parseFloat(row.yield_factor) || 1;
    const nc = parseFloat(row.nominal_cost) || 0;
    return {
      product_id: productId,
      supplier_id: row.supplier_id || null,
      purchase_uom_label: row.purchase_uom_label,
      purchase_uom_name: row.purchase_uom_label,  // sync
      purchase_uom: row.purchase_uom,
      conversion_factor: cf,
      yield_factor: yf,
      effective_internal_qty: cf * yf,
      nominal_cost: nc,
      price_per_stock_unit: nc / (cf * yf),
      is_default_supplier: row.is_default || false,
      supplier_sku: row.supplier_sku || '',
      supplier_description: row.supplier_description || '',
    };
  };

  const handleAdd = async () => {
    if (!newRow.purchase_uom_label.trim() || !newRow.conversion_factor || !newRow.nominal_cost) {
      toast.error('Label, conversion factor, and nominal cost are required');
      return;
    }
    setSaving(true);
    try {
      const selectedSupplier = allSuppliers.find(s => s.id === newRow.supplier_id);
      if (newRow.is_default) {
        for (const sp of supplierProducts.filter(sp => sp.is_default_supplier)) {
          await base44.entities.SupplierProduct.update(sp.id, { is_default_supplier: false });
        }
      }
      const nc = parseFloat(newRow.nominal_cost) || 0;
      await base44.entities.SupplierProduct.create({
        ...buildPayload(newRow),
        product_name: product?.name || '',
        product_sku: product?.sku || '',
        supplier_name: selectedSupplier?.name || '',
        last_purchase_price: nc,  // seed
      });
      invalidate();
      setNewRow(EMPTY_ROW);
      setAdding(false);
      toast.success('Purchasing unit added');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (sp) => {
    setEditingId(sp.id);
    setEditRow({
      purchase_uom_label: sp.purchase_uom_label || sp.purchase_uom_name || '',
      purchase_uom: sp.purchase_uom || 'kg',
      supplier_id: sp.supplier_id || '',
      conversion_factor: String(sp.conversion_factor || sp.purchase_to_stock_factor || ''),
      yield_factor: String(sp.yield_factor ?? 1),
      nominal_cost: String(sp.nominal_cost ?? ''),
      last_purchase_price: sp.last_purchase_price ?? null,
      supplier_sku: sp.supplier_sku || '',
      supplier_description: sp.supplier_description || '',
      is_default: sp.is_default_supplier || false,
    });
  };

  const handleSaveEdit = async () => {
    if (!editRow.purchase_uom_label.trim() || !editRow.conversion_factor || !editRow.nominal_cost) {
      toast.error('Label, conversion factor, and nominal cost are required');
      return;
    }
    setSaving(true);
    try {
      if (editRow.is_default) {
        for (const sp of supplierProducts.filter(sp => sp.is_default_supplier && sp.id !== editingId)) {
          await base44.entities.SupplierProduct.update(sp.id, { is_default_supplier: false });
        }
      }
      await base44.entities.SupplierProduct.update(editingId, buildPayload(editRow));
      invalidate();
      setEditingId(null);
      setEditRow(null);
      toast.success('Purchasing unit updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    await base44.entities.SupplierProduct.delete(id);
    invalidate();
    setDeleteId(null);
    toast.success('Purchasing unit removed');
  };

  const handleSetDefault = async (id) => {
    for (const sp of supplierProducts) {
      const shouldBeDefault = sp.id === id;
      if (shouldBeDefault !== !!sp.is_default_supplier) {
        await base44.entities.SupplierProduct.update(sp.id, { is_default_supplier: shouldBeDefault });
      }
    }
    invalidate();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold">Purchasing Units</h4>
          <p className="text-xs text-muted-foreground">
            How this product is ordered from suppliers — each purchasing unit converts to {stockUom || 'stock UoM'}
          </p>
        </div>
        {!adding && !editingId && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add Purchasing Unit
          </Button>
        )}
      </div>

      {/* Existing units — table view */}
      {isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : supplierProducts.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Name</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Supplier</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Conversion</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Nominal Cost</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Last GRN</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Price/{stockUom || 'stock'}</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">SKU</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {supplierProducts.map(sp => {
                const cf = sp.conversion_factor || sp.purchase_to_stock_factor || 0;
                const yf = sp.yield_factor || 1;
                const nc = sp.nominal_cost || 0;
                const pricePerStock = sp.price_per_stock_unit != null
                  ? sp.price_per_stock_unit
                  : (cf > 0 && yf > 0 && nc > 0 ? nc / (cf * yf) : null);
                if (editingId === sp.id && editRow) {
                  return (
                    <tr key={sp.id} className="bg-primary/5">
                      <td colSpan={8} className="px-3 py-3">
                        <UomForm
                          row={editRow}
                          onChange={(k, v) => setEditRow(p => ({ ...p, [k]: v }))}
                          activeSuppliers={allSuppliers}
                          stockUom={stockUom}
                          onSave={handleSaveEdit}
                          onCancel={() => { setEditingId(null); setEditRow(null); }}
                          saving={saving}
                        />
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={sp.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2.5 font-medium">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleSetDefault(sp.id)}
                          className={`shrink-0 ${sp.is_default_supplier ? 'text-yellow-500' : 'text-muted-foreground/30 hover:text-yellow-400'}`}
                          title={sp.is_default_supplier ? 'Default' : 'Set as default'}
                        >
                          <Star className="w-3.5 h-3.5" fill={sp.is_default_supplier ? 'currentColor' : 'none'} />
                        </button>
                        {sp.purchase_uom_label || sp.purchase_uom_name}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground text-xs">{sp.supplier_name || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{cf} × {stockUom || 'unit'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{nc > 0 ? formatZAR(nc) : '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">
                      {sp.last_purchase_price != null && sp.last_purchase_price > 0 ? formatZAR(sp.last_purchase_price) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">
                      {pricePerStock != null ? formatZAR(pricePerStock) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono">{sp.supplier_sku || '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => startEdit(sp)} title="Edit">
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-destructive" onClick={() => setDeleteId(sp.id)} title="Delete">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {supplierProducts.length === 0 && !adding && !isLoading && (
        <p className="text-xs text-muted-foreground py-2 italic">No purchasing units defined yet. Click "Add Purchasing Unit" to add one.</p>
      )}

      {/* Add form */}
      {adding && (
        <UomForm
          row={newRow}
          onChange={(k, v) => setNewRow(p => ({ ...p, [k]: v }))}
          activeSuppliers={allSuppliers}
          stockUom={stockUom}
          onSave={handleAdd}
          onCancel={() => { setAdding(false); setNewRow(EMPTY_ROW); }}
          saving={saving}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove purchasing unit?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the purchasing unit from this product. Existing POs using this unit will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleDelete(deleteId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
