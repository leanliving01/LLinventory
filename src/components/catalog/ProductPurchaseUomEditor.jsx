import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Star, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function ProductPurchaseUomEditor({ productId, stockUom, suppliers = [] }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newRow, setNewRow] = useState({ label: '', purchase_to_stock_factor: '', supplier_id: '', is_default: false, notes: '' });

  const { data: uoms = [], isLoading } = useQuery({
    queryKey: ['product-purchase-uoms', productId],
    queryFn: () => base44.entities.ProductPurchaseUom.filter({ product_id: productId }),
    enabled: !!productId,
  });

  const handleAdd = async () => {
    if (!newRow.label.trim() || !newRow.purchase_to_stock_factor) {
      toast.error('Label and conversion factor are required');
      return;
    }
    setSaving(true);
    const supplier = suppliers.find(s => s.id === newRow.supplier_id);
    
    // If marking as default, unset others first
    if (newRow.is_default) {
      for (const u of uoms.filter(u => u.is_default)) {
        await base44.entities.ProductPurchaseUom.update(u.id, { is_default: false });
      }
    }

    await base44.entities.ProductPurchaseUom.create({
      product_id: productId,
      label: newRow.label.trim(),
      purchase_to_stock_factor: Number(newRow.purchase_to_stock_factor),
      supplier_id: newRow.supplier_id || '',
      supplier_name: supplier?.name || '',
      is_default: newRow.is_default,
      notes: newRow.notes,
    });
    queryClient.invalidateQueries({ queryKey: ['product-purchase-uoms', productId] });
    setNewRow({ label: '', purchase_to_stock_factor: '', supplier_id: '', is_default: false, notes: '' });
    setAdding(false);
    setSaving(false);
    toast.success('Purchase UoM added');
  };

  const handleDelete = async (id) => {
    await base44.entities.ProductPurchaseUom.delete(id);
    queryClient.invalidateQueries({ queryKey: ['product-purchase-uoms', productId] });
    toast.success('Removed');
  };

  const handleSetDefault = async (id) => {
    for (const u of uoms) {
      if (u.id === id && !u.is_default) {
        await base44.entities.ProductPurchaseUom.update(u.id, { is_default: true });
      } else if (u.id !== id && u.is_default) {
        await base44.entities.ProductPurchaseUom.update(u.id, { is_default: false });
      }
    }
    queryClient.invalidateQueries({ queryKey: ['product-purchase-uoms', productId] });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold">Purchase Units</h4>
          <p className="text-xs text-muted-foreground">Different ways you can buy this product — each converts to {stockUom || 'stock UoM'}</p>
        </div>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add Unit
          </Button>
        )}
      </div>

      {/* Existing UoMs */}
      {isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : uoms.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground py-2">No purchase units defined yet. The legacy Purchase UoM field above still applies.</p>
      ) : (
        <div className="space-y-2">
          {uoms.map(u => (
            <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-muted/30">
              <button
                onClick={() => handleSetDefault(u.id)}
                className={`shrink-0 ${u.is_default ? 'text-yellow-500' : 'text-muted-foreground/30 hover:text-yellow-400'}`}
                title={u.is_default ? 'Default' : 'Set as default'}
              >
                <Star className="w-4 h-4" fill={u.is_default ? 'currentColor' : 'none'} />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{u.label}</p>
                <p className="text-xs text-muted-foreground">
                  1 × {u.label} = {u.purchase_to_stock_factor} {stockUom || 'units'}
                  {u.supplier_name && <span className="ml-2">· {u.supplier_name}</span>}
                  {u.notes && <span className="ml-2 italic">· {u.notes}</span>}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="w-8 h-8 text-destructive shrink-0" onClick={() => handleDelete(u.id)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {adding && (
        <div className="border border-dashed border-primary/40 rounded-lg p-4 space-y-3 bg-primary/5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Label *</Label>
              <Input
                placeholder="e.g. 6-Pack, Case of 24, Box of 10kg"
                value={newRow.label}
                onChange={e => setNewRow(p => ({ ...p, label: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">= how many {stockUom || 'stock units'} *</Label>
              <Input
                type="number"
                placeholder="e.g. 6"
                value={newRow.purchase_to_stock_factor}
                onChange={e => setNewRow(p => ({ ...p, purchase_to_stock_factor: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Supplier (optional)</Label>
              <Select value={newRow.supplier_id || 'none'} onValueChange={v => setNewRow(p => ({ ...p, supplier_id: v === 'none' ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="Any supplier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Any supplier —</SelectItem>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes (optional)</Label>
              <Input
                placeholder="e.g. Only from Bidfood"
                value={newRow.notes}
                onChange={e => setNewRow(p => ({ ...p, notes: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={newRow.is_default} onCheckedChange={v => setNewRow(p => ({ ...p, is_default: v }))} />
            <span className="text-xs text-muted-foreground">Set as default for new PO lines</span>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAdd} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}