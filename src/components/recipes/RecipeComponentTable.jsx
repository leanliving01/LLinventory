import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

const LAYER_LABELS = { prep: 'Prep', cook: 'Cook', portion: 'Portion', pack: 'Pack' };
const LAYER_COLORS = {
  prep: 'bg-purple-100 text-purple-700',
  cook: 'bg-orange-100 text-orange-700',
  portion: 'bg-green-100 text-green-700',
  pack: 'bg-blue-100 text-blue-700',
};

/**
 * Ingredients table for a BOM recipe.
 *
 * A BOM = a production layer, so an ingredient's layer is the BOM it lives in
 * (`_layer`). Props:
 *  - components: rows (each carries bom_id, step_no, _layer).
 *  - operationsByBom: { [bomId]: operation[] } — builds the per-row step dropdown.
 *  - showLayer: render the Layer column.
 *  - onLayerChange(comp, bomType) + availableLayers: move the ingredient to
 *    another layer (BOM). If omitted, the layer shows as a read-only badge.
 *  - onStepChange(compId, stepNo): pin the ingredient to a specific step.
 *  - subRecipeProductIds / onOpenSubRecipe: open an in-house ingredient's recipe.
 *  - showActive + activeEdits + onActiveToggle: render an "Active" switch per row
 *    (packing BOMs only). Toggling a meal off removes it from the pack's stock
 *    deduction (derives pack_boms.disabled_skus) without deleting the component.
 */
export default function RecipeComponentTable({
  title, icon, components, loading, editedQtys, onQtyChange,
  onRemove, onAdd, operationsByBom = {}, onStepChange,
  showLayer = false, onLayerChange, availableLayers = [],
  subRecipeProductIds, onOpenSubRecipe,
  selectable = false, selectedIds, onToggleSelect, onToggleSelectAll,
  showActive = false, activeEdits, onActiveToggle,
}) {
  const opsFor = (c) => operationsByBom[c.bom_id] || [];
  const isActive = (c) => activeEdits?.[c.id] ?? (c.is_active !== false);
  const anyHasSteps = !!onStepChange && Object.values(operationsByBom).some(ops => (ops || []).length > 0);
  const isSel = (id) => selectedIds?.has?.(id);
  const allSel = selectable && components.length > 0 && components.every(c => isSel(c.id));

  const makeDayLabel = (c) =>
    c.make_day === 'cook_day' ? 'Cook day'
    : c.make_day === 'portion_day' ? 'Portion day'
    : '';

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          {icon} {title} ({components.length})
        </h3>
        {onAdd && (
          <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={onAdd}>
            <Plus className="w-3 h-3" /> Add
          </Button>
        )}
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : components.length === 0 ? (
        <p className="text-xs text-muted-foreground">No ingredients linked</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                {selectable && (
                  <th className="px-3 py-2 w-9">
                    <input type="checkbox" className="rounded w-4 h-4" checked={allSel}
                      onChange={() => onToggleSelectAll?.(components.map(c => c.id), !allSel)} />
                  </th>
                )}
                {showActive && (
                  <th className="text-center px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-16">Active</th>
                )}
                {showLayer && (
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Layer</th>
                )}
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">SKU</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Ingredient</th>
                {anyHasSteps && (
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Step</th>
                )}
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Qty</th>
                <th className="text-center px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">UoM</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Notes</th>
                {onRemove && <th className="w-10"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {components.map(c => {
                const editedVal = editedQtys?.[c.id];
                const currentQty = editedVal !== undefined ? editedVal : String(c.qty);
                const isChanged = editedVal !== undefined && Number(editedVal) !== c.qty;
                const assignedStep = c.step_no || 0;
                const stepOptions = [...opsFor(c)]
                  .sort((a, b) => (a.step_no || 0) - (b.step_no || 0))
                  .map(op => ({ value: String(op.step_no), label: `${op.step_no}. ${op.name}` }));
                const hasSteps = !!onStepChange && stepOptions.length > 0;
                const isSubRecipe = subRecipeProductIds?.has(c.input_product_id);
                const layer = c._layer;
                const active = isActive(c);

                return (
                  <tr key={c.id} className={cn(
                    "hover:bg-muted/20",
                    isChanged && "bg-amber-50 dark:bg-amber-900/10",
                    isSel(c.id) && "bg-primary/5",
                    showActive && !active && "bg-red-50/40 dark:bg-red-900/10 opacity-60",
                  )}>
                    {selectable && (
                      <td className="px-3 py-2">
                        <input type="checkbox" className="rounded w-4 h-4" checked={!!isSel(c.id)}
                          onChange={() => onToggleSelect?.(c.id)} />
                      </td>
                    )}
                    {showActive && (
                      <td className="px-3 py-2 text-center">
                        <Switch checked={active} onCheckedChange={(v) => onActiveToggle?.(c.id, v)} className="scale-90" />
                      </td>
                    )}
                    {showLayer && (
                      <td className="px-3 py-1.5">
                        {onLayerChange && availableLayers.length > 0 ? (
                          <Select value={layer || ''} onValueChange={v => onLayerChange(c, v)}>
                            <SelectTrigger className="h-7 text-[11px] w-28"><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              {availableLayers.map(l => (
                                <SelectItem key={l.value} value={l.value} className="text-xs">{l.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : layer ? (
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", LAYER_COLORS[layer] || 'bg-muted text-muted-foreground')}>
                            {LAYER_LABELS[layer] || layer}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </td>
                    )}
                    <td className={cn("px-3 py-2 text-xs font-mono", showActive && !active && "line-through text-muted-foreground")}>{c.input_product_sku}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={cn("inline-flex items-center gap-1.5", showActive && !active && "line-through text-muted-foreground")}>
                        {c.input_product_name}
                        {isSubRecipe && onOpenSubRecipe && (
                          <button
                            type="button"
                            onClick={() => onOpenSubRecipe(c.input_product_id)}
                            className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline"
                            title="Open this ingredient's own recipe"
                          >
                            <ExternalLink className="w-3 h-3" /> recipe
                          </button>
                        )}
                      </span>
                    </td>
                    {anyHasSteps && (
                      <td className="px-3 py-1.5">
                        {hasSteps ? (
                          <Select
                            value={String(assignedStep)}
                            onValueChange={v => onStepChange(c.id, Number(v))}
                          >
                            <SelectTrigger className="h-7 text-[11px] w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0" className="text-xs">Any step</SelectItem>
                              {stepOptions.map(s => (
                                <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-1.5 text-right">
                      {onQtyChange ? (
                        <Input type="number" step="any" min="0" value={currentQty}
                          onChange={e => onQtyChange(c.id, e.target.value)}
                          className={cn("w-20 h-7 text-right text-xs ml-auto", isChanged && "border-amber-400")} />
                      ) : (
                        <span className="text-xs tabular-nums">{c.qty}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-center">{c.uom}</td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground">
                      {makeDayLabel(c) ? <Badge variant="outline" className="text-[9px] font-normal">{makeDayLabel(c)}</Badge> : '—'}
                    </td>
                    {onRemove && (
                      <td className="px-1 py-2">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => onRemove(c)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
