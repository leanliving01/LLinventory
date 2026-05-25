import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { PACKAGE_LABELS } from '@/lib/mealGrouping';
import CreateCustomSKU from './CreateCustomSKU';

export default function VariantBOMEditor({ packageProduct, familyColors }) {
  const queryClient = useQueryClient();
  const [addSkuId, setAddSkuId] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const [showCreateSKU, setShowCreateSKU] = useState(false);

  const { data: skus = [] } = useQuery({
    queryKey: ['skus'],
    queryFn: () => base44.entities.SKU.list('-sku_code', 500),
  });

  const { data: bomLines = [], isLoading } = useQuery({
    queryKey: ['bomLines', packageProduct.id],
    queryFn: () => base44.entities.PackageBOMLine.filter({ package_product_id: packageProduct.id }, '-created_date', 200),
  });

  const activeBomLines = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    return bomLines.filter(line => !line.effective_to || line.effective_to >= today);
  }, [bomLines]);

  const availableSkus = useMemo(() => {
    const usedSkuIds = new Set(activeBomLines.map(l => l.sku_id));
    return skus.filter(s => s.is_active !== false && !usedSkuIds.has(s.id));
  }, [skus, activeBomLines]);

  const totalMeals = activeBomLines.reduce((sum, l) => sum + (l.quantity_per_pack || 0), 0);

  const handleAddLine = async () => {
    if (!addSkuId) return;
    setSaving(true);
    const sku = skus.find(s => s.id === addSkuId);
    const today = format(new Date(), 'yyyy-MM-dd');
    await base44.entities.PackageBOMLine.create({
      package_product_id: packageProduct.id,
      sku_id: addSkuId,
      sku_display_name: sku?.display_name || sku?.meal_name || '',
      quantity_per_pack: Number(addQty),
      effective_from: today,
    });
    queryClient.invalidateQueries({ queryKey: ['bomLines', packageProduct.id] });
    setAddSkuId('');
    setAddQty(1);
    toast.success(`Added ${sku?.display_name || 'SKU'} to BOM`);
    setSaving(false);
  };

  const handleRemoveLine = async (line) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    await base44.entities.PackageBOMLine.update(line.id, { effective_to: today });
    queryClient.invalidateQueries({ queryKey: ['bomLines', packageProduct.id] });
    toast.success('Removed from BOM');
  };

  const handleUpdateQty = async (line, newQty) => {
    if (!newQty || Number(newQty) < 1) return;
    await base44.entities.PackageBOMLine.update(line.id, { quantity_per_pack: Number(newQty) });
    queryClient.invalidateQueries({ queryKey: ['bomLines', packageProduct.id] });
  };

  if (isLoading) {
    return <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  return (
    <div>
      {/* Header summary */}
      <div className="px-6 py-3 bg-muted/20 border-b border-border flex items-center justify-between">
        <div className="text-sm">
          <span className="font-semibold">{packageProduct.name}</span>
          <span className="text-muted-foreground ml-2">— Bill of Materials</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Meals in BOM:</span>
          <span className={cn(
            "text-sm font-bold tabular-nums",
            totalMeals === packageProduct.pack_size ? 'text-emerald-600' : 'text-amber-600'
          )}>
            {totalMeals} / {packageProduct.pack_size}
          </span>
        </div>
      </div>

      {/* Add SKU controls */}
      <div className="px-6 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <Select value={addSkuId} onValueChange={setAddSkuId}>
          <SelectTrigger className="w-[280px]">
            <SelectValue placeholder="Select a meal / SKU to add..." />
          </SelectTrigger>
          <SelectContent>
            {availableSkus.map(sku => (
              <SelectItem key={sku.id} value={sku.id}>
                {sku.display_name || sku.meal_name} {sku.package_type ? `(${PACKAGE_LABELS[sku.package_type] || sku.package_type})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          min="1"
          value={addQty}
          onChange={e => setAddQty(e.target.value)}
          className="w-16 text-center h-9"
          placeholder="Qty"
        />
        <Button size="sm" onClick={handleAddLine} disabled={!addSkuId || saving} className="gap-2">
          <Plus className="w-3.5 h-3.5" />
          Add
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowCreateSKU(!showCreateSKU)} className="gap-2 ml-auto">
          + Custom SKU
        </Button>
      </div>

      {showCreateSKU && (
        <div className="border-b border-border">
          <CreateCustomSKU onClose={() => setShowCreateSKU(false)} />
        </div>
      )}

      {/* BOM table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Meal / SKU</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">SKU Code</th>
              <th className="text-center px-4 py-2 text-xs font-semibold text-muted-foreground uppercase w-24">Qty per Pack</th>
              <th className="text-center px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Effective From</th>
              <th className="text-center px-4 py-2 text-xs font-semibold text-muted-foreground uppercase w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {activeBomLines.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No meals in this BOM yet. Add SKUs above.
                </td>
              </tr>
            ) : activeBomLines.map(line => {
              const sku = skus.find(s => s.id === line.sku_id);
              return (
                <tr key={line.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium">
                    {line.sku_display_name || sku?.display_name || 'Unknown'}
                    {line.is_replacement && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Replacement</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">
                    {sku?.sku_code || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <Input
                      type="number"
                      min="1"
                      value={line.quantity_per_pack}
                      onChange={e => handleUpdateQty(line, e.target.value)}
                      className="w-14 text-center h-7 text-xs mx-auto"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-center text-xs text-muted-foreground">
                    {line.effective_from || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleRemoveLine(line)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}