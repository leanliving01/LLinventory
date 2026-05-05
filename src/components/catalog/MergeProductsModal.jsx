import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Merge, Loader2, Star, AlertTriangle, Check } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Modal to preview and execute a product merge.
 * Props:
 *   products: array of Product objects to merge
 *   onClose: () => void
 *   onMerged: () => void — called after successful merge
 */
export default function MergeProductsModal({ products, onClose, onMerged }) {
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [executed, setExecuted] = useState(false);

  const handlePreview = async () => {
    setLoading(true);
    const res = await base44.functions.invoke('mergeProducts', {
      product_ids: products.map(p => p.id),
      preview: true,
    });
    setPlan(res.data.plan);
    setLoading(false);
  };

  const handleExecute = async () => {
    setLoading(true);
    const res = await base44.functions.invoke('mergeProducts', {
      product_ids: products.map(p => p.id),
      preview: false,
    });
    setLoading(false);
    setExecuted(true);
    toast.success(`Merged ${res.data.results.archived_duplicates} duplicate(s) into ${res.data.plan.canonical.sku}`);
    setTimeout(() => onMerged(), 1500);
  };

  // Auto-preview on mount
  React.useEffect(() => { handlePreview(); }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Merge className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">Merge Products</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {loading && !plan && (
            <div className="text-center py-12">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Analysing products...</p>
            </div>
          )}

          {executed && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 flex items-center gap-3">
              <Check className="w-5 h-5 text-green-600 shrink-0" />
              <p className="text-sm text-green-700 dark:text-green-300">Merge completed successfully! Duplicates archived.</p>
            </div>
          )}

          {plan && !executed && (
            <>
              {/* Canonical product */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Canonical Product (kept)</p>
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 flex items-center gap-3">
                  <Star className="w-5 h-5 text-green-600 shrink-0" />
                  <div>
                    <p className="text-sm font-bold">{plan.canonical.name}</p>
                    <p className="text-xs font-mono text-muted-foreground">{plan.canonical.sku} · {plan.canonical.bom_references} BOM reference(s)</p>
                  </div>
                </div>
              </div>

              {/* Duplicates to archive */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                  Will be archived ({plan.duplicates_to_archive.length})
                </p>
                <div className="space-y-2">
                  {plan.duplicates_to_archive.map(d => (
                    <div key={d.id} className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-center gap-3">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{d.name}</p>
                        <p className="text-xs font-mono text-muted-foreground">{d.sku} · {d.bom_references} BOM ref(s)</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Fields being merged */}
              {plan.fields_to_merge.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Fields to fill on canonical
                  </p>
                  <div className="bg-muted/30 border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/50 border-b border-border">
                          <th className="text-left px-3 py-2">Field</th>
                          <th className="text-left px-3 py-2">Value</th>
                          <th className="text-left px-3 py-2">From</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {plan.fields_to_merge.map((f, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5 font-mono">{f.field}</td>
                            <td className="px-3 py-1.5">{String(f.value)}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{f.from_sku}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Supplier products to create */}
              {plan.supplier_products_to_create.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Supplier links to create
                  </p>
                  <div className="space-y-2">
                    {plan.supplier_products_to_create.map((sp, i) => (
                      <div key={i} className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                        {sp.note ? (
                          <p className="text-xs text-blue-700 dark:text-blue-300">{sp.note}</p>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium">{sp.supplier_name}</p>
                              <p className="text-xs text-muted-foreground">
                                SKU: {sp.supplier_sku} · {sp.purchase_uom_label || sp.purchase_uom} · 1 unit = {sp.conversion_factor} {sp.conversion_uom}
                              </p>
                            </div>
                            <Badge className="text-[10px] bg-blue-100 text-blue-700">New</Badge>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {plan.duplicates_to_archive.some(d => d.bom_references > 0) && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-700 dark:text-red-300">Warning: BOM references on duplicates</p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      Some duplicates are referenced in BOMs. These BOM references will NOT be updated automatically — you may need to update them manually.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {plan && !executed && (
          <div className="px-6 py-4 border-t border-border shrink-0 flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1 gap-2" onClick={handleExecute} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Merge className="w-4 h-4" />}
              Execute Merge
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}