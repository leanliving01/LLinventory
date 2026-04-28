import React, { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Save, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function PackingRuleForm({ rule, products, onClose, defaultTrigger }) {
  const queryClient = useQueryClient();
  const isEditing = !!rule;

  const [name, setName] = useState(rule?.name || '');
  const [trigger, setTrigger] = useState(rule?.trigger || defaultTrigger || 'has_meals');
  const [materialProductId, setMaterialProductId] = useState(rule?.material_product_id || '');
  const [deductionMode, setDeductionMode] = useState(rule?.deduction_mode || 'fixed_per_order');
  const [qtyPerDeduction, setQtyPerDeduction] = useState(rule?.qty_per_deduction ?? 1);
  const [perXItems, setPerXItems] = useState(rule?.per_x_items ?? 30);
  const [notes, setNotes] = useState(rule?.notes || '');
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  const filteredProducts = useMemo(() => {
    if (!productSearch) return products;
    const s = productSearch.toLowerCase();
    return products.filter(p => p.name?.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s));
  }, [products, productSearch]);

  const selectedProduct = products.find(p => p.id === materialProductId);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!materialProductId) { toast.error('Select a packaging material'); return; }
    if (qtyPerDeduction <= 0) { toast.error('Quantity must be > 0'); return; }

    setSaving(true);
    const product = products.find(p => p.id === materialProductId);
    const data = {
      name: name.trim(),
      trigger,
      material_product_id: materialProductId,
      material_sku: product?.sku || '',
      material_name: product?.name || '',
      deduction_mode: deductionMode,
      qty_per_deduction: Number(qtyPerDeduction),
      per_x_items: deductionMode === 'per_x_items' ? Number(perXItems) : 1,
      notes: notes.trim() || undefined,
      is_active: rule?.is_active ?? true,
    };

    if (isEditing) {
      await base44.entities.PackingMaterialRule.update(rule.id, data);
      toast.success(`Updated "${name}"`);
    } else {
      await base44.entities.PackingMaterialRule.create(data);
      toast.success(`Created "${name}"`);
    }

    queryClient.invalidateQueries({ queryKey: ['packing-material-rules'] });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-16 px-4">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-card z-10">
          <h3 className="text-sm font-semibold">{isEditing ? 'Edit Rule' : 'New Packing Material Rule'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Rule Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Supplement Box, Ice Packs" />
          </div>

          {/* Trigger */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">When does this fire?</Label>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="has_supplements">Order has supplements</SelectItem>
                <SelectItem value="has_meals">Order has meals</SelectItem>
                <SelectItem value="always">Every order</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Material product */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Packaging Material to Deduct</Label>
            {selectedProduct ? (
              <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border border-border">
                <div className="flex-1">
                  <p className="text-sm font-medium">{selectedProduct.name}</p>
                  <p className="text-xs font-mono text-muted-foreground">{selectedProduct.sku}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setMaterialProductId('')}>Change</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search packaging products..."
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
                <div className="max-h-40 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                  {filteredProducts.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-3 text-center">No packaging products found</p>
                  ) : (
                    filteredProducts.slice(0, 20).map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setMaterialProductId(p.id); setProductSearch(''); }}
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors"
                      >
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-xs font-mono text-muted-foreground">{p.sku}</p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Deduction mode */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Deduction Mode</Label>
            <Select value={deductionMode} onValueChange={setDeductionMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed_per_order">Fixed per order (e.g. 1 box per order)</SelectItem>
                <SelectItem value="per_x_items">Per X items (e.g. 4 ice packs per 30 meals)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Qty */}
          <div className={cn("grid gap-4", deductionMode === 'per_x_items' ? 'grid-cols-2' : 'grid-cols-1')}>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Qty to Deduct</Label>
              <Input
                type="number"
                min={1}
                value={qtyPerDeduction}
                onChange={e => setQtyPerDeduction(e.target.value)}
                className="tabular-nums"
              />
            </div>
            {deductionMode === 'per_x_items' && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Per Every X Items</Label>
                <Input
                  type="number"
                  min={1}
                  value={perXItems}
                  onChange={e => setPerXItems(e.target.value)}
                  className="tabular-nums"
                />
              </div>
            )}
          </div>

          {/* Summary sentence */}
          <div className="bg-muted/30 rounded-lg p-3 border border-border">
            <p className="text-xs text-muted-foreground">
              <strong>Summary:</strong>{' '}
              {deductionMode === 'fixed_per_order'
                ? `Deduct ${qtyPerDeduction} × ${selectedProduct?.name || '(select material)'} per order when ${trigger === 'has_supplements' ? 'supplements are present' : trigger === 'has_meals' ? 'meals are present' : 'any order is packed'}.`
                : `Deduct ${qtyPerDeduction} × ${selectedProduct?.name || '(select material)'} for every ${perXItems} ${trigger === 'has_supplements' ? 'supplements' : trigger === 'has_meals' ? 'meals' : 'items'} in the order. (Rounded up — e.g. 31 items = ${Number(qtyPerDeduction) * 2} deducted)`
              }
            </p>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Notes (optional)</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes..." />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end gap-3 sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" strokeWidth={1.5} />}
            {isEditing ? 'Update' : 'Create Rule'}
          </Button>
        </div>
      </div>
    </div>
  );
}