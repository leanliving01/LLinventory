import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, CookingPot } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function CreateCookingRunModal({ onCreated, onCancel }) {
  const [bulkProductId, setBulkProductId] = useState('');
  const [targetKg, setTargetKg] = useState('');
  const [runDate, setRunDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [saving, setSaving] = useState(false);

  const { data: wipProducts = [] } = useQuery({
    queryKey: ['wip-bulk-products'],
    queryFn: () => base44.entities.Product.filter({ type: 'wip_bulk', status: 'active' }, 'name', 100),
  });

  const { data: cookBoms = [] } = useQuery({
    queryKey: ['cook-boms'],
    queryFn: () => base44.entities.Bom.filter({ bom_type: 'cook', is_active: true }, 'product_name', 100),
  });

  const selectedProduct = wipProducts.find(p => p.id === bulkProductId);
  const matchingBom = cookBoms.find(b => b.product_id === bulkProductId);

  const handleCreate = async () => {
    if (!bulkProductId || !targetKg || Number(targetKg) <= 0) {
      toast.error('Select a bulk product and enter a target output');
      return;
    }
    setSaving(true);

    // Generate run number
    const existing = await base44.entities.CookingRun.list('-created_date', 1);
    let nextNum = 1;
    if (existing.length > 0) {
      const parts = (existing[0].run_number || '').split('-');
      const seq = parseInt(parts[parts.length - 1] || '0', 10);
      nextNum = (isNaN(seq) ? 0 : seq) + 1;
    }
    const runNumber = `COOK-${new Date().getFullYear()}-${String(nextNum).padStart(4, '0')}`;

    const data = {
      run_number: runNumber,
      run_date: runDate,
      status: 'draft',
      run_type: 'standard',
      bulk_product_id: bulkProductId,
      bulk_product_name: selectedProduct?.name || '',
      bulk_product_sku: selectedProduct?.sku || '',
      target_output_kg: Number(targetKg),
      cook_bom_id: matchingBom?.id || null,
      bom_expected_yield_pct: matchingBom ? (matchingBom.yield_qty || 100) : null,
      raw_product_id: selectedProduct?.primary_yield_ingredient_id || null,
      raw_product_name: selectedProduct?.primary_yield_ingredient_name || null,
      raw_cost_per_kg: selectedProduct?.cost_avg || 0,
    };

    const created = await base44.entities.CookingRun.create(data);
    toast.success(`Cooking run ${runNumber} created`);
    setSaving(false);
    onCreated(created);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative bg-card rounded-xl shadow-xl w-full max-w-lg p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <CookingPot className="w-5 h-5 text-primary" /> New Cooking Run
          </h2>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Bulk Cooked Product</label>
            <Select value={bulkProductId} onValueChange={setBulkProductId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select product..." /></SelectTrigger>
              <SelectContent>
                {wipProducts.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.sku} — {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {wipProducts.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">No WIP bulk products found. Create products with type "wip_bulk" first.</p>
            )}
          </div>

          {selectedProduct && !matchingBom && (
            <p className="text-xs text-amber-600">No active Cook recipe found for this product. Yield data won't auto-calculate.</p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Target Output (kg)</label>
              <Input type="number" min="0.1" step="0.1" value={targetKg} onChange={e => setTargetKg(e.target.value)} placeholder="e.g. 25" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Run Date</label>
              <Input type="date" value={runDate} onChange={e => setRunDate(e.target.value)} className="mt-1" />
            </div>
          </div>

          {selectedProduct && (
            <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1">
              <p><span className="text-muted-foreground">Raw ingredient:</span> {selectedProduct.primary_yield_ingredient_name || 'Not configured'}</p>
              <p><span className="text-muted-foreground">Avg cost:</span> R {(selectedProduct.cost_avg || 0).toFixed(2)}/kg</p>
              {matchingBom && <p><span className="text-muted-foreground">Recipe:</span> {matchingBom.product_name}</p>}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving || !bulkProductId || !targetKg} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CookingPot className="w-4 h-4" />}
            Create Run
          </Button>
        </div>
      </div>
    </div>
  );
}