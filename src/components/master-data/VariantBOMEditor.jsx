import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

// LEGACY package BOM editor — now READ-ONLY.
//
// This editor used to create / update / soft-delete `PackageBOMLine` rows for a
// legacy `PackageProduct`. Those rows feed NOTHING in the live stock / deduction
// / production / par flow, so editing here only produced orphan data.
//
// The correct, modern flow is to define the package's components in its
// PACKING BOM (a Catalog product with type = "package"), which derives the
// pack_boms explosion map that actually drives deduction, demand and packing.
//
// Existing legacy lines are still listed below (so nothing visually disappears),
// but all add / edit / remove actions have been removed.
export default function VariantBOMEditor({ packageProduct }) {
  const { data: skus = [] } = useQuery({
    queryKey: ['skus'],
    queryFn: () => base44.entities.SKU.list('-sku_code', 500),
  });

  const { data: bomLines = [], isLoading } = useQuery({
    queryKey: ['bomLines', packageProduct.id],
    queryFn: () => base44.entities.PackageBOMLine.filter({ package_product_id: packageProduct.id }, '-created_date', 200),
  });

  const activeBomLines = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    return bomLines.filter(line => !line.effective_to || line.effective_to >= today);
  }, [bomLines]);

  const totalMeals = activeBomLines.reduce((sum, l) => sum + (l.quantity_per_pack || 0), 0);

  if (isLoading) {
    return <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  return (
    <div>
      {/* Header summary */}
      <div className="px-6 py-3 bg-muted/20 border-b border-border flex items-center justify-between">
        <div className="text-sm">
          <span className="font-semibold">{packageProduct.name}</span>
          <span className="text-muted-foreground ml-2">— Bill of Materials (legacy, read-only)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Meals in BOM:</span>
          <span className={cn(
            "text-sm font-bold tabular-nums",
            totalMeals === packageProduct.pack_size ? 'text-emerald-600' : 'text-amber-600'
          )}>
            {totalMeals} / {packageProduct.pack_size}
          </span>
        </div>
      </div>

      {/* Legacy notice — creation/editing retired */}
      <div className="px-6 py-3 border-b border-border bg-amber-50/60 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">This legacy package BOM is read-only.</p>
          <p className="mt-1">
            Define this package&apos;s components in the <span className="font-semibold text-foreground">Catalog</span> instead:
            create the package as a product with <span className="font-mono text-foreground">type = package</span>, then open its{' '}
            <span className="font-semibold text-foreground">Packing BOM</span>. The Packing BOM drives the live deduction,
            demand and packing flow; rows shown below do not.
          </p>
        </div>
      </div>

      {/* BOM table (read-only) */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Meal / SKU</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">SKU Code</th>
              <th className="text-center px-4 py-2 text-xs font-semibold text-muted-foreground uppercase w-24">Qty per Pack</th>
              <th className="text-center px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Effective From</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {activeBomLines.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No legacy meals in this BOM.
                </td>
              </tr>
            ) : activeBomLines.map(line => {
              const sku = skus.find(s => s.id === line.sku_id);
              return (
                <tr key={line.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium">
                    {line.sku_display_name || sku?.display_name || 'Unknown'}
                    {line.is_replacement && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Replacement</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">
                    {sku?.sku_code || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center text-sm tabular-nums">
                    {line.quantity_per_pack}
                  </td>
                  <td className="px-4 py-2.5 text-center text-xs text-muted-foreground">
                    {line.effective_from || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
