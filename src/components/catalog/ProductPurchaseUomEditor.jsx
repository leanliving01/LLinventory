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

const EMPTY_ROW = {
  purchase_uom_name: '',
  supplier_id: '',
  conversion_factor: '',
  price_per_purchase_uom: '',
  supplier_sku: '',
  supplier_barcode: '',
  supplier_description: '',
  is_default: false,
};

function UomForm({ row, onChange, productionSuppliers, stockUom, onSave, onCancel, saving }) {
  const cf = parseFloat(row.conversion_factor);
  const pp = parseFloat(row.price_per_purchase_uom);
  const pricePerStock = cf > 0 && pp > 0 ? pp / cf : null;

  return (
    <div className="border border-dashed border-primary/40 rounded-lg p-4 space-y-3 bg-primary/5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Purchase Unit Name *</Label>
          <Input
            placeholder="e.g. 25kg Bag, Case of 6, 25L Drum"
            value={row.purchase_uom_name}
            onChange={e => onChange('purchase_uom_name', e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Supplier *</Label>
          <Select value={row.supplier_id || 'none'} onValueChange={v => onChange('supplier_id', v === 'none' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="Select production supplier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Select supplier —</SelectItem>
              {productionSuppliers.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {productionSuppliers.length === 0 && (
            <p className="text-[10px] text-amber-600">No production suppliers yet — mark a supplier as "Production Supplier" first.</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Conversion Factor * (1 unit = X {stockUom || 'stock units'})</Label>
          <Input
            type="number"
            placeholder={`e.g. 25 (if 1 bag = 25 ${stockUom || 'units'})`}
            value={row.conversion_factor}
            onChange={e => onChange('conversion_factor', e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Price per Purchase Unit (ZAR, excl. VAT) *</Label>
          <Input
            type="number"
            step="0.01"
            placeholder="e.g. 450.00"
            value={row.price_per_purchase_uom}
            onChange={e => onChange('price_per_purchase_uom', e.target.value)}
          />
        </div>
      </div>

      {/* Computed price per stock UOM */}
      {pricePerStock != null && (
        <div className="px-3 py-2 bg-background rounded-md border border-border text-sm">
          <span className="text-muted-foreground">Price per {stockUom || 'stock unit'}: </span>
          <span className="font-semibold text-foreground">{formatZAR(pricePerStock)}</span>
          <span className="text-muted-foreground ml-1">(= {formatZAR(pp)} ÷ {cf})</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Supplier SKU</Label>
          <Input
            placeholder="Supplier's product code"
            value={row.supplier_sku}
            onChange={e => onChange('supplier_sku', e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Supplier Barcode</Label>
          <Input
            placeholder="Barcode for GRN scanning"
            value={row.supplier_barcode}
            onChange={e => onChange('supplier_barcode', e.target.value)}
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

export default function ProductPurchaseUomEditor({ productId, stockUom }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [newRow, setNewRow] = useState(EMPTY_ROW);
  const [editRow, setEditRow] = useState(null);

  const { data: uoms = [], isLoading } = useQuery({
    queryKey: ['product-purchase-uoms', productId],
    queryFn: () => base44.entities.ProductPurchaseUom.filter({ product_id: productId }),
    enabled: !!productId,
  });

  // Fetch production suppliers only
  const { data: allSuppliers = [] } = useQuery({
    queryKey: ['suppliers-production'],
    queryFn: () => base44.entities.Supplier.filter({ is_production_supplier: true, status: 'active' }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['product-purchase-uoms', productId] });

  const buildPayload = (row, supplierId) => {
    const supplier = allSuppliers.find(s => s.id === supplierId);
    const cf = parseFloat(row.conversion_factor) || 0;
    const pp = parseFloat(row.price_per_purchase_uom) || 0;
    return {
      product_id: productId,
      purchase_uom_name: row.purchase_uom_name.trim(),
      label: row.purchase_uom_name.trim(), // keep label in sync for legacy compat
      supplier_id: supplierId || null,
      supplier_name: supplier?.name || '',
      conversion_factor: cf,
      purchase_to_stock_factor: cf, // keep legacy field in sync
      price_per_purchase_uom: pp,
      supplier_sku: row.supplier_sku || '',
      supplier_barcode: row.supplier_barcode || '',
      supplier_description: row.supplier_description || '',
      is_default: row.is_default || false,
    };
  };

  const handleAdd = async () => {
    if (!newRow.purchase_uom_name.trim() || !newRow.conversion_factor || !newRow.price_per_purchase_uom) {
      toast.error('Name, conversion factor, and price are required');
      return;
    }
    setSaving(true);
    try {
      if (newRow.is_default) {
        for (const u of uoms.filter(u => u.is_default)) {
          await base44.entities.ProductPurchaseUom.update(u.id, { is_default: false });
        }
      }
      await base44.entities.ProductPurchaseUom.create(buildPayload(newRow, newRow.supplier_id));
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

  const startEdit = (uom) => {
    setEditingId(uom.id);
    setEditRow({
      purchase_uom_name: uom.purchase_uom_name || uom.label || '',
      supplier_id: uom.supplier_id || '',
      conversion_factor: String(uom.conversion_factor || uom.purchase_to_stock_factor || ''),
      price_per_purchase_uom: String(uom.price_per_purchase_uom || ''),
      supplier_sku: uom.supplier_sku || '',
      supplier_barcode: uom.supplier_barcode || '',
      supplier_description: uom.supplier_description || '',
      is_default: uom.is_default || false,
    });
  };

  const handleSaveEdit = async () => {
    if (!editRow.purchase_uom_name.trim() || !editRow.conversion_factor || !editRow.price_per_purchase_uom) {
      toast.error('Name, conversion factor, and price are required');
      return;
    }
    setSaving(true);
    try {
      if (editRow.is_default) {
        for (const u of uoms.filter(u => u.is_default && u.id !== editingId)) {
          await base44.entities.ProductPurchaseUom.update(u.id, { is_default: false });
        }
      }
      await base44.entities.ProductPurchaseUom.update(editingId, buildPayload(editRow, editRow.supplier_id));
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
    await base44.entities.ProductPurchaseUom.delete(id);
    invalidate();
    setDeleteId(null);
    toast.success('Purchasing unit removed');
  };

  const handleSetDefault = async (id) => {
    for (const u of uoms) {
      const shouldBeDefault = u.id === id;
      if (shouldBeDefault !== !!u.is_default) {
        await base44.entities.ProductPurchaseUom.update(u.id, { is_default: shouldBeDefault });
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
      ) : uoms.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Name</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Supplier</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Conversion</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Price/Unit</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Price/{stockUom || 'stock'}</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">SKU</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {uoms.map(u => {
                const cf = u.conversion_factor || u.purchase_to_stock_factor || 0;
                const pp = u.price_per_purchase_uom || 0;
                const pricePerStock = cf > 0 && pp > 0 ? pp / cf : null;
                if (editingId === u.id && editRow) {
                  return (
                    <tr key={u.id} className="bg-primary/5">
                      <td colSpan={7} className="px-3 py-3">
                        <UomForm
                          row={editRow}
                          onChange={(k, v) => setEditRow(p => ({ ...p, [k]: v }))}
                          productionSuppliers={allSuppliers}
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
                  <tr key={u.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2.5 font-medium">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleSetDefault(u.id)}
                          className={`shrink-0 ${u.is_default ? 'text-yellow-500' : 'text-muted-foreground/30 hover:text-yellow-400'}`}
                          title={u.is_default ? 'Default' : 'Set as default'}
                        >
                          <Star className="w-3.5 h-3.5" fill={u.is_default ? 'currentColor' : 'none'} />
                        </button>
                        {u.purchase_uom_name || u.label}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground text-xs">{u.supplier_name || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{cf} × {stockUom || 'unit'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{pp > 0 ? formatZAR(pp) : '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">
                      {pricePerStock != null ? formatZAR(pricePerStock) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono">{u.supplier_sku || '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => startEdit(u)} title="Edit">
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-destructive" onClick={() => setDeleteId(u.id)} title="Delete">
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

      {uoms.length === 0 && !adding && !isLoading && (
        <p className="text-xs text-muted-foreground py-2 italic">No purchasing units defined yet. Click "Add Purchasing Unit" to add one.</p>
      )}

      {/* Add form */}
      {adding && (
        <UomForm
          row={newRow}
          onChange={(k, v) => setNewRow(p => ({ ...p, [k]: v }))}
          productionSuppliers={allSuppliers}
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
