import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATION_COLORS = {
  prep: 'bg-blue-100 text-blue-700',
  cook: 'bg-amber-100 text-amber-700',
  portion: 'bg-green-100 text-green-700',
};

/**
 * Renders the ingredients table for a BOM recipe.
 * When `operations` are provided, shows a "Step" column so users can assign each ingredient
 * to a specific operation step (or leave as "All steps").
 */
export default function RecipeComponentTable({
  title, icon, components, loading, editedQtys, onQtyChange,
  onRemove, onAdd, operations = [], onStepChange,
}) {
  // Build step options from operations
  const stepOptions = operations
    .slice()
    .sort((a, b) => (a.step_no || 0) - (b.step_no || 0))
    .map(op => ({
      value: String(op.step_no),
      label: `${op.step_no}. ${op.name}`,
    }));

  const hasSteps = stepOptions.length > 0 && !!onStepChange;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          {icon} {title} ({components.length})
        </h3>
        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={onAdd}>
          <Plus className="w-3 h-3" /> Add
        </Button>
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
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">SKU</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Name</th>
                {hasSteps && (
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Step</th>
                )}
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Qty</th>
                <th className="text-center px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">UoM</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {components.map(c => {
                const editedVal = editedQtys[c.id];
                const currentQty = editedVal !== undefined ? editedVal : String(c.qty);
                const isChanged = editedVal !== undefined && Number(editedVal) !== c.qty;
                const assignedStep = c.step_no || 0;
                const matchedOp = operations.find(op => op.step_no === assignedStep);

                return (
                  <tr key={c.id} className={cn("hover:bg-muted/20", isChanged && "bg-amber-50 dark:bg-amber-900/10")}>
                    <td className="px-3 py-2 text-xs font-mono">{c.input_product_sku}</td>
                    <td className="px-3 py-2 text-xs">{c.input_product_name}</td>
                    {hasSteps && (
                      <td className="px-3 py-1.5">
                        <Select
                          value={String(assignedStep)}
                          onValueChange={v => onStepChange(c.id, Number(v))}
                        >
                          <SelectTrigger className="h-7 text-[11px] w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0" className="text-xs">All steps</SelectItem>
                            {stepOptions.map(s => (
                              <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    )}
                    <td className="px-3 py-1.5 text-right">
                      <Input type="number" step="any" min="0" value={currentQty}
                        onChange={e => onQtyChange(c.id, e.target.value)}
                        className={cn("w-20 h-7 text-right text-xs ml-auto", isChanged && "border-amber-400")} />
                    </td>
                    <td className="px-3 py-2 text-xs text-center">{c.uom}</td>
                    <td className="px-1 py-2">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => onRemove(c)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
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