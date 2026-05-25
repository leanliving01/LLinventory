import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export default function PackBomMealRow({ sku, productName, isDisabled, multiplier, defaultMultiplier, onToggle, onMultiplierChange }) {
  const isOverridden = !isDisabled && multiplier !== defaultMultiplier;

  return (
    <tr className={cn(
      'transition-colors',
      isDisabled ? 'bg-red-50/50 dark:bg-red-900/10 opacity-60' : 'hover:bg-muted/20',
      isOverridden && !isDisabled && 'bg-amber-50/50 dark:bg-amber-900/10'
    )}>
      <td className="px-3 py-2.5 text-center">
        <Switch checked={!isDisabled} onCheckedChange={onToggle} className="scale-90" />
      </td>
      <td className="px-3 py-2.5 text-xs font-mono">
        <span className={isDisabled ? 'line-through text-muted-foreground' : ''}>{sku}</span>
      </td>
      <td className="px-3 py-2.5 text-sm">
        <span className={isDisabled ? 'line-through text-muted-foreground' : ''}>{productName}</span>
      </td>
      <td className="px-3 py-2 text-center">
        {isDisabled ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <Input
            type="number"
            min="0"
            value={multiplier}
            onChange={e => onMultiplierChange(e.target.value)}
            className={cn(
              'w-16 h-7 text-center text-xs mx-auto tabular-nums',
              isOverridden && 'border-amber-400 bg-amber-50 dark:bg-amber-900/20'
            )}
          />
        )}
      </td>
    </tr>
  );
}