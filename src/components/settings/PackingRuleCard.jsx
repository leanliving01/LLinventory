import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Pencil, Trash2, Pill, IceCream, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

const TRIGGER_CONFIG = {
  has_supplements: { label: 'Supplements', icon: Pill, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  has_meals:       { label: 'Meals',       icon: IceCream, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  always:          { label: 'Every Order', icon: Package, color: 'bg-muted text-muted-foreground' },
};

export default function PackingRuleCard({ rule, onEdit, onToggle, onDelete }) {
  const trigger = TRIGGER_CONFIG[rule.trigger] || TRIGGER_CONFIG.always;
  const TriggerIcon = trigger.icon;

  const deductionLabel = rule.deduction_mode === 'fixed_per_order'
    ? `${rule.qty_per_deduction} per order`
    : `${rule.qty_per_deduction} per every ${rule.per_x_items} items`;

  return (
    <div className={cn("px-6 py-4 flex items-center gap-4", !rule.is_active && "opacity-50")}>
      <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", trigger.color)}>
        <TriggerIcon className="w-5 h-5" strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{rule.name}</p>
        <p className="text-xs text-muted-foreground">
          Deduct <strong className="tabular-nums">{deductionLabel}</strong> of <strong>{rule.material_name || rule.material_sku}</strong>
        </p>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-[10px]">When: {trigger.label}</Badge>
          {rule.notes && <span className="text-[10px] text-muted-foreground truncate">{rule.notes}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
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