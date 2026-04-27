import React from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const VARIANCE_REASONS = [
  { value: 'as_planned', label: 'As planned' },
  { value: 'higher_yield', label: 'Higher yield than expected' },
  { value: 'lower_yield', label: 'Lower yield than expected' },
  { value: 'power_outage', label: 'Power outage / load shedding' },
  { value: 'equipment_failure', label: 'Equipment failure' },
  { value: 'ingredient_shortage', label: 'Ingredient shortage' },
  { value: 'recipe_error', label: 'Recipe needs adjustment' },
  { value: 'staff_error', label: 'Staff error' },
  { value: 'quality_rejected', label: 'Quality rejected' },
  { value: 'other', label: 'Other' },
];

/**
 * Group lines by base meal name so variants (MLM/MWL/WLM/WWL) appear together.
 * Strips variant suffixes and sorts groups alphabetically, variants within each group by SKU.
 */
function groupLines(lines) {
  const VARIANT_PREFIXES = ['MLM', 'MWL', 'WLM', 'WWL', 'LC'];
  
  const getGroupKey = (line) => {
    // Strip variant prefix + number from SKU to get base name
    const sku = line.product_sku || '';
    for (const prefix of VARIANT_PREFIXES) {
      if (sku.startsWith(prefix) && /^\d+$/.test(sku.slice(prefix.length))) {
        return sku.slice(prefix.length); // just the meal number
      }
    }
    // For descriptive MWL SKUs (BeeandBea-2, SweChiChi etc.), use the name cleaned
    const name = (line.product_name || '').replace(/\s+(MLM|MWL|WLM|WWL)\d*\s*$/i, '').trim();
    return name.toLowerCase();
  };

  const groups = {};
  for (const line of lines) {
    const key = getGroupKey(line);
    if (!groups[key]) groups[key] = [];
    groups[key].push(line);
  }

  // Sort each group by SKU, then flatten
  const sorted = [];
  const groupKeys = Object.keys(groups).sort();
  for (const key of groupKeys) {
    groups[key].sort((a, b) => (a.product_sku || '').localeCompare(b.product_sku || ''));
    sorted.push(...groups[key]);
  }
  return { sorted, groups, groupKeys };
}

export default function RunLineTable({ lines, actuals, reasons, onActualChange, onReasonChange, isEditable, isScheduled, onEditLine, onDeleteLine }) {
  if (lines.length === 0) {
    return <div className="text-center py-8 text-sm text-muted-foreground">No lines in this run</div>;
  }

  const { sorted, groups, groupKeys } = groupLines(lines);

  // Build a map from line index → group index for zebra striping
  const lineGroupIndex = {};
  let currentGroupIdx = -1;
  let lastGroupKey = null;
  const PREFIXES_Z = ['MLM', 'MWL', 'WLM', 'WWL', 'LC'];
  const getGroupKeyForLine = (l) => {
    const s = l.product_sku || '';
    for (const p of PREFIXES_Z) {
      if (s.startsWith(p) && /^\d+$/.test(s.slice(p.length))) return s.slice(p.length);
    }
    return (l.product_name || '').replace(/\s+(MLM|MWL|WLM|WWL)\d*\s*$/i, '').trim().toLowerCase();
  };
  sorted.forEach((line, idx) => {
    const key = getGroupKeyForLine(line);
    if (key !== lastGroupKey) {
      currentGroupIdx++;
      lastGroupKey = key;
    }
    lineGroupIndex[idx] = currentGroupIdx;
  });

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Meal</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-24">SKU</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-20">SOH</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-20">COM</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-20">PAR</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-20">Planned</th>
              <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-24">Actual</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-16">+/-</th>
              {isEditable && <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase min-w-[180px]">Reason</th>}
              {!isEditable && <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase">Reason</th>}
              {isScheduled && <th className="text-center px-2 py-3 text-xs font-semibold text-muted-foreground uppercase w-20">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((line, idx) => {
              const actual = actuals[line.id];
              const actualNum = actual !== undefined && actual !== '' ? Number(actual) : null;
              const variance = actualNum !== null ? actualNum - line.planned_qty : null;
              const hasVariance = variance !== null && variance !== 0;
              const reason = reasons?.[line.id] || line.variance_reason || '';

              const groupIdx = lineGroupIndex[idx];
              const isEvenGroup = groupIdx % 2 === 0;
              const isFirstInGroup = idx === 0 || lineGroupIndex[idx] !== lineGroupIndex[idx - 1];

              // Zebra: even groups get a darker tinted background, odd groups stay light
              const zebraBg = isEvenGroup ? 'bg-slate-100 dark:bg-slate-800/60' : 'bg-white dark:bg-slate-900/40';

              return (
                <tr key={line.id} className={cn(zebraBg, "hover:bg-muted/60 transition-colors", hasVariance && "!bg-amber-50/60", isFirstInGroup && idx > 0 && "border-t-2 border-primary/20")}>
                  <td className="px-4 py-2.5 text-sm font-medium">{line.product_name}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono">{line.product_sku}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">{line.soh_at_plan}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums text-amber-600">{line.committed_at_plan || '—'}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">{line.par_at_plan || '—'}</td>
                  <td className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums">{line.planned_qty}</td>
                  <td className="px-3 py-2.5 text-center">
                    {isEditable ? (
                      <Input
                        type="number"
                        min="0"
                        value={actual ?? ''}
                        placeholder={String(line.planned_qty)}
                        onChange={e => onActualChange(line.id, e.target.value)}
                        className="w-20 text-right h-8 text-sm mx-auto"
                      />
                    ) : (
                      <span className="text-sm font-semibold tabular-nums">{line.actual_qty}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                    {variance !== null ? (
                      <span className={cn(
                        "font-medium",
                        variance > 0 && "text-green-600",
                        variance < 0 && "text-red-600",
                        variance === 0 && "text-muted-foreground"
                      )}>
                        {variance > 0 ? '+' : ''}{variance}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {isEditable ? (
                      hasVariance ? (
                        <Select value={reason} onValueChange={v => onReasonChange(line.id, v)}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select reason..." />
                          </SelectTrigger>
                          <SelectContent>
                            {VARIANCE_REASONS.filter(r => r.value !== 'as_planned').map(r => (
                              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )
                    ) : (
                      <span className="text-xs">{reason ? VARIANCE_REASONS.find(r => r.value === reason)?.label || reason : '—'}</span>
                    )}
                  </td>
                  {isScheduled && (
                    <td className="px-2 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={(e) => { e.stopPropagation(); onEditLine?.(line); }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-red-600"
                          onClick={(e) => { e.stopPropagation(); onDeleteLine?.(line.id); }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-muted/30 border-t border-border">
              <td colSpan={5} className="px-4 py-3 text-sm font-bold">Totals</td>
              <td className="px-3 py-3 text-right text-sm font-bold tabular-nums">
                {lines.reduce((s, l) => s + l.planned_qty, 0)}
              </td>
              <td className="px-3 py-3 text-center text-sm font-bold tabular-nums">
                {lines.reduce((s, l) => s + (Number(actuals[l.id]) || 0), 0)}
              </td>
              <td className="px-3 py-3 text-right text-sm font-bold tabular-nums">
                {(() => {
                  const totalVariance = lines.reduce((s, l) => {
                    const a = actuals[l.id];
                    if (a === undefined || a === '') return s;
                    return s + (Number(a) - l.planned_qty);
                  }, 0);
                  return (
                    <span className={cn(
                      totalVariance > 0 && "text-green-600",
                      totalVariance < 0 && "text-red-600"
                    )}>
                      {totalVariance > 0 ? '+' : ''}{totalVariance}
                    </span>
                  );
                })()}
              </td>
              <td />
              {isScheduled && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}