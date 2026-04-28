import React from 'react';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Circle, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPackThemeOrDone, getPackTheme, DEFAULT_THEME } from '@/lib/packColorThemes';

/**
 * Grouped pack list — items grouped by parent package with heading.
 * Props:
 *  - groups: [{ groupKey, label, subtitle, colorTheme?, items: [{key, sku, skuLower, name, qty, ...}] }]
 *  - scannedMap: { skuLower: count }
 */
/** Remove variant text from product name when it's already shown separately */
function stripVariantFromName(name, variant) {
  if (!name || !variant) return name;
  // Case-insensitive check: if name ends with the variant, strip it
  const lower = name.toLowerCase();
  const vLower = variant.toLowerCase();
  if (lower.endsWith(vLower)) {
    return name.slice(0, name.length - variant.length).replace(/[\s\-–—]+$/, '').trim() || name;
  }
  // Also check if variant words appear as a suffix (e.g. "Protein Pudding Chocolate Brownie" / "Chocolate Brownie")
  if (lower.includes(vLower)) {
    const idx = lower.indexOf(vLower);
    const before = name.slice(0, idx).replace(/[\s\-–—]+$/, '').trim();
    const after = name.slice(idx + variant.length).trim();
    return (before + (after ? ' ' + after : '')).trim() || name;
  }
  return name;
}

export default function FloorPackList({ groups, scannedMap }) {
  return (
    <div className="space-y-4">
      {groups.map(group => {
        const groupScanned = group.items.reduce((s, i) => s + (scannedMap[i.skuLower] || 0), 0);
        const groupTotal = group.items.reduce((s, i) => s + (i.qty || 0), 0);
        const groupDone = groupScanned >= groupTotal && groupTotal > 0;

        const theme = getPackThemeOrDone(group.colorTheme, groupDone);
        const activeTheme = getPackTheme(group.colorTheme);

        return (
          <div key={group.groupKey} className="space-y-2">
            {/* Group heading */}
            <div className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl border-2",
              theme.headerBg, theme.headerBorder
            )}>
              <Package className={cn("w-5 h-5 shrink-0", theme.icon)} strokeWidth={1.5} />
              <div className="flex-1 min-w-0">
                <p className={cn("font-bold text-sm truncate", theme.headerText)}>{group.label}</p>
                {group.subtitle && (
                  <p className="text-[11px] text-muted-foreground">{group.subtitle}</p>
                )}
              </div>
              <Badge className={cn(
                "tabular-nums text-xs shrink-0",
                groupDone ? "bg-green-100 text-green-700" : cn(activeTheme.badgeBg, activeTheme.badgeText)
              )}>
                {groupScanned}/{groupTotal}
              </Badge>
            </div>

            {/* Items in this group */}
            {group.items.map(item => {
              const scannedQty = scannedMap[item.skuLower] || 0;
              const isDone = scannedQty >= item.qty;

              const itemTheme = isDone
                ? { border: 'border-green-200 dark:border-green-800', bg: 'bg-green-50 dark:bg-green-900/20' }
                : { border: activeTheme.itemBorder, bg: activeTheme.itemBg };

              return (
                <div
                  key={item.key}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-2xl border-2 ml-3 transition-colors",
                    itemTheme.bg, itemTheme.border,
                  )}
                >
                  {isDone ? (
                    <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" strokeWidth={1.5} />
                  ) : (
                    <Circle className={cn("w-6 h-6 shrink-0", activeTheme.icon)} strokeWidth={1.5} />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={cn("font-semibold text-2xl truncate", isDone && "line-through text-muted-foreground")}>
                      {item.variantTitle
                        ? <>{stripVariantFromName(item.name, item.variantTitle)} – <span className="font-bold">{item.variantTitle}</span></>
                        : item.name}
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground">{item.sku}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold tabular-nums">
                      <span className={isDone ? "text-green-600" : "text-foreground"}>{scannedQty}</span>
                      <span className="text-muted-foreground">/{item.qty}</span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}