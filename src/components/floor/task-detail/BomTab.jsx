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

      {/* Steps with their assigned ingredients */}
      {operations && operations.length > 0 ? (
        <div className="space-y-3">
          {[...operations].sort((a, b) => (a.step_no || 0) - (b.step_no || 0)).map((op, idx) => {
            const stepComps = components?.filter(c => c.step_no === op.step_no) || [];
            return (
              <div key={op.id} className="bg-card border rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                    {op.step_no || idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm">{op.name}</p>
                    {op.notes && <p className="text-xs text-muted-foreground truncate">{op.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-[10px] capitalize">{op.station}</Badge>
                    {op.cycle_time_min && (
                      <Badge variant="outline" className="text-[10px]">{op.cycle_time_min} min</Badge>
                    )}
                  </div>
                </div>
                {stepComps.length > 0 && (
                  <div className="divide-y">
                    {stepComps.map(c => (
                      <div key={c.id} className="px-4 py-2.5 flex items-center justify-between">
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
                )}
                {stepComps.length === 0 && (
                  <div className="px-4 py-2.5 text-xs text-muted-foreground">No ingredients assigned to this step</div>
                )}
              </div>
            );
          })}

          {/* Shared ingredients (not assigned to any step) */}
          {(() => {
            const shared = components?.filter(c => !c.step_no) || [];
            if (shared.length === 0) return null;
            return (
              <div className="bg-card border rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
                  <Package className="w-4 h-4 text-muted-foreground" />
                  <h3 className="font-bold text-sm">All Steps</h3>
                </div>
                <div className="divide-y">
                  {shared.map(c => (
                    <div key={c.id} className="px-4 py-2.5 flex items-center justify-between">
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
            );
          })()}
        </div>
      ) : components && components.length > 0 ? (
        /* Fallback: no operations defined, just show flat list */
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
      ) : null}
    </div>
  );
}