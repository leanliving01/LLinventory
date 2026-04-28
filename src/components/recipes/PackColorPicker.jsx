import React from 'react';
import { cn } from '@/lib/utils';
import { PACK_COLOR_THEMES } from '@/lib/packColorThemes';

const COLOR_OPTIONS = Object.entries(PACK_COLOR_THEMES);

/**
 * Compact color theme picker for PackBom / BOM creation.
 * Renders clickable color dots with labels.
 */
export default function PackColorPicker({ value, onChange }) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
        Packing Color Theme
      </label>
      <p className="text-xs text-muted-foreground mb-3">
        Staff will see this color when packing orders containing this package.
      </p>
      <div className="flex flex-wrap gap-2">
        {COLOR_OPTIONS.map(([key, theme]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all text-sm font-medium",
              value === key
                ? cn(theme.headerBorder, theme.headerBg, theme.headerText)
                : "border-border bg-card hover:bg-muted/50 text-muted-foreground"
            )}
          >
            <span className={cn("w-3 h-3 rounded-full shrink-0", theme.dot)} />
            {theme.label}
          </button>
        ))}
      </div>
    </div>
  );
}