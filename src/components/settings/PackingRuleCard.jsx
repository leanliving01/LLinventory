import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Pencil, Trash2, Pill, UtensilsCrossed, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

const TRIGGER_CONFIG = {
  has_supplements: { label: 'Supplements', icon: Pill, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  has_meals:       { label: 'Meals',       icon: UtensilsCrossed, color: 'bg-status-info-subtle text-status-info' },
  always:          { label: 'Every Order', icon: Package, color: 'bg-muted text-muted-foreground' },
};

/** Parse materials JSON, fallback to legacy single material */
function getMaterials(rule) {
  if (rule.materials) {
    try {
      const parsed = JSON.parse(rule.materials);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* fall through */ }
  }
  if (rule.material_product_id) {
    return [{
      name: rule.material_name || rule.material_sku || '?',
      sku: rule.material_sku || '',
      deduction_mode: rule.deduction_mode || 'fixed_per_order',
      qty_per_deduction: rule.qty_per_deduction ?? 1,
      per_x_items: rule.per_x_items ?? 1,
    }];
  }
  return [];
}

function deductionLabel(mat) {
  if (mat.deduction_mode === 'per_x_items') {
    return `${mat.qty_per_deduction} per ${mat.per_x_items} items`;
  }
  return `${mat.qty_per_deduction} per order`;
}

export default function PackingRuleCard({ rule, onEdit, onToggle, onDelete }) {
  const trigger = TRIGGER_CONFIG[rule.trigger] || TRIGGER_CONFIG.always;
  const TriggerIcon = trigger.icon;
  const materials = getMaterials(rule);

  return (
    <div className={cn("px-6 py-4 flex items-start gap-4", !rule.is_active && "opacity-50")}>
      <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5", trigger.color)}>
        <TriggerIcon className="w-5 h-5" strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{rule.name}</p>
        {/* Materials list */}
        <div className="mt-1.5 space-y-1">
          {materials.map((mat, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              <span className="tabular-nums font-medium text-foreground">{deductionLabel(mat)}</span>
              {' '}of <strong>{mat.name || mat.sku}</strong>
            </p>
          ))}
        </div>
        {rule.notes && (
          <p className="text-[10px] text-muted-foreground mt-1 truncate">{rule.notes}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 mt-1">
        <Switch
          checked={rule.is_active}
          onCheckedChange={() => onToggle(rule)}
        />
        <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => onEdit(rule)}>
          <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
        </Button>
        <Button variant="ghost" size="icon" className="w-8 h-8 text-destructive hover:text-destructive" onClick={() => onDelete(rule)}>
          <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
        </Button>
      </div>
    </div>
  );
}