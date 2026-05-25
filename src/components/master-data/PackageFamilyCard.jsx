import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import VariantBOMEditor from './VariantBOMEditor';

export default function PackageFamilyCard({ familyName, familyCode, variants, colors }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState(null);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Family header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center justify-between px-6 py-4 transition-colors hover:opacity-90",
          colors.light
        )}
      >
        <div className="flex items-center gap-3">
          <Package className={cn("w-5 h-5", colors.lightText)} />
          <div className="text-left">
            <h3 className={cn("text-sm font-bold", colors.lightText)}>{familyName}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {variants.length} variant{variants.length !== 1 ? 's' : ''}: {variants.map(v => `${v.pack_size} meals`).join(', ')}
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className={cn("w-4 h-4", colors.lightText)} />
        ) : (
          <ChevronRight className={cn("w-4 h-4", colors.lightText)} />
        )}
      </button>

      {/* Variant list */}
      {expanded && (
        <div className="border-t border-border">
          <div className="flex border-b border-border bg-muted/30">
            {variants.map(variant => (
              <button
                key={variant.id}
                onClick={() => setSelectedVariantId(selectedVariantId === variant.id ? null : variant.id)}
                className={cn(
                  "flex-1 px-4 py-3 text-sm font-medium text-center transition-colors border-r border-border last:border-r-0",
                  selectedVariantId === variant.id
                    ? cn(colors.light, colors.lightText, "font-bold")
                    : "hover:bg-muted/50 text-muted-foreground"
                )}
              >
                {variant.pack_size} Meal Pack
              </button>
            ))}
          </div>

          {selectedVariantId ? (
            <VariantBOMEditor
              packageProduct={variants.find(v => v.id === selectedVariantId)}
              familyColors={colors}
            />
          ) : (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-muted-foreground">Select a variant above to manage its Bill of Materials</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}