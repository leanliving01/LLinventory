import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Package, ListChecks } from 'lucide-react';

/**
 * "BOM" tab — read-only summary of the recipe: components list and operation steps.
 */
export default function BomTab({ bom, components, operations, taskQty }) {
  const scale = bom?.yield_qty ? (taskQty || 1) / bom.yield_qty : 1;

  if (!bom) {
    return (
      <div className="text-center py-10">
        <p className="text-muted-foreground text-sm">No recipe found for this product.</p>
      </div>
    );
  }

  const bomTypeLabel = { cook: 'Cook Recipe', portion: 'Portion Recipe', pack: 'Pack Recipe', prep: 'Prep Recipe' }[bom.bom_type] || 'Recipe';

  return (
    <div className="space-y-4">
      {/* BOM header info */}
      <div className="bg-card border rounded-2xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm">{bomTypeLabel}</h3>
          <Badge variant="outline" className="text-xs">v{bom.version || 1}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Output:</span>
            <p className="font-medium">{bom.product_name || bom.product_sku}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Yield:</span>
            <p className="font-bold tabular-nums">{bom.yield_qty} {bom.yield_uom || ''}</p>
          </div>
        </div>
      </div>

      {/* Components list */}
      {components && components.length > 0 && (
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <Package className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-bold text-sm">Components</h3>
          </div>
          <div className="divide-y">
            {components.map(c => (
              <div key={c.id} className="px-4 py-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{c.input_product_name}</p>
                  <p className="text-xs font-mono text-muted-foreground">{c.input_product_sku}</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="font-bold tabular-nums text-sm">{Math.round(c.qty * scale * 100) / 100} {c.uom}</p>
                  {c.is_consumable && <Badge className="bg-purple-100 text-purple-700 text-[10px]">Consumable</Badge>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Operations */}
      {operations && operations.length > 0 && (
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-bold text-sm">Steps</h3>
          </div>
          <div className="divide-y">
            {operations.map((op, idx) => (
              <div key={op.id} className="px-4 py-3 flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">
                  {op.step_no || idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{op.name}</p>
                  {op.notes && <p className="text-xs text-muted-foreground truncate">{op.notes}</p>}
                </div>
                {op.cycle_time_min && (
                  <Badge variant="outline" className="text-[10px] shrink-0">{op.cycle_time_min} min</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}