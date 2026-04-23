import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, Package, Utensils, Wrench } from 'lucide-react';

const LAYER_LABELS = { cook: 'Cook', portion: 'Portion', pack: 'Pack' };
const LAYER_COLORS = {
  cook: 'bg-orange-100 text-orange-700',
  portion: 'bg-green-100 text-green-700',
  pack: 'bg-blue-100 text-blue-700',
};
const LAYER_DESC = {
  cook: 'Raw materials → Bulk cooked (WIP)',
  portion: 'Bulk cooked → Portioned meal',
  pack: 'Meals → Package',
};

export default function RecipeDetailDrawer({ bom, onClose }) {
  const { data: components = [], isLoading: loadingComps } = useQuery({
    queryKey: ['bom-components', bom.id],
    queryFn: () => base44.entities.BomComponent.filter({ bom_id: bom.id }),
  });

  const { data: operations = [], isLoading: loadingOps } = useQuery({
    queryKey: ['bom-operations', bom.id],
    queryFn: () => base44.entities.BomOperation.filter({ bom_id: bom.id }),
  });

  const sortedOps = [...operations].sort((a, b) => (a.step_no || 0) - (b.step_no || 0));
  const ingredients = components.filter(c => !c.is_consumable);
  const consumables = components.filter(c => c.is_consumable);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-card shadow-xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-start justify-between z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge className={`text-[10px] ${LAYER_COLORS[bom.bom_type]}`}>
                {LAYER_LABELS[bom.bom_type]}
              </Badge>
              {bom.is_active ? (
                <Badge className="text-[10px] bg-green-100 text-green-700">Active</Badge>
              ) : (
                <Badge className="text-[10px] bg-gray-100 text-gray-500">Inactive</Badge>
              )}
            </div>
            <h2 className="text-lg font-bold">{bom.product_name}</h2>
            <p className="text-xs text-muted-foreground font-mono">{bom.product_sku}</p>
            <p className="text-xs text-muted-foreground mt-1">{LAYER_DESC[bom.bom_type]}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* Yield info */}
          <div className="bg-muted/50 rounded-lg p-4 flex items-center gap-4">
            <Package className="w-5 h-5 text-primary" />
            <div>
              <p className="text-sm font-medium">Yield: {bom.yield_qty} {bom.yield_uom}</p>
              <p className="text-xs text-muted-foreground">Version {bom.version || 1}</p>
            </div>
          </div>

          {/* Ingredients */}
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <Utensils className="w-4 h-4 text-primary" />
              Ingredients ({ingredients.length})
            </h3>
            {loadingComps ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : ingredients.length === 0 ? (
              <p className="text-xs text-muted-foreground">No ingredients linked</p>
            ) : (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">SKU</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Name</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Qty</th>
                      <th className="text-center px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">UoM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ingredients.map(c => (
                      <tr key={c.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2 text-xs font-mono">{c.input_product_sku}</td>
                        <td className="px-3 py-2 text-xs">{c.input_product_name}</td>
                        <td className="px-3 py-2 text-xs text-right tabular-nums">{c.qty}</td>
                        <td className="px-3 py-2 text-xs text-center">{c.uom}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Consumables */}
          {consumables.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Package className="w-4 h-4 text-muted-foreground" />
                Packaging / Consumables ({consumables.length})
              </h3>
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">SKU</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Name</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {consumables.map(c => (
                      <tr key={c.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2 text-xs font-mono">{c.input_product_sku}</td>
                        <td className="px-3 py-2 text-xs">{c.input_product_name}</td>
                        <td className="px-3 py-2 text-xs text-right tabular-nums">{c.qty} {c.uom}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Operations */}
          {sortedOps.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Wrench className="w-4 h-4 text-primary" />
                Steps ({sortedOps.length})
              </h3>
              <div className="space-y-2">
                {sortedOps.map((op, i) => (
                  <div key={op.id} className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2.5">
                    <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                      {op.step_no || i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{op.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{op.station} station{op.cycle_time_min ? ` · ~${op.cycle_time_min} min` : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {bom.notes && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Notes</h3>
              <p className="text-sm text-muted-foreground">{bom.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}