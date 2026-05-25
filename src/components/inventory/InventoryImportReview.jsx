import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, X, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

// Fallback location: PE Main Warehouse — used when product has no default_location_id and no SOH record
const FALLBACK_LOCATION_ID = '69ea6bec8ec21eb79273085e';

/**
 * Modal that shows a diff of what will change when importing a CSV.
 * User must confirm before changes are applied.
 *
 * Props:
 *  - diffs: [{ product, currentStock, changes: { on_hand?: {from, to}, reorder_point?: {from, to} } }]
 *  - parseErrors: string[]
 *  - onClose()
 *  - onImportComplete()
 */
export default function InventoryImportReview({ diffs, parseErrors, onClose, onImportComplete }) {
  const [importing, setImporting] = useState(false);

  const handleConfirm = async () => {
    setImporting(true);

    for (const diff of diffs) {
      const { product, currentStock, changes } = diff;

      // Update reorder point on Product
      if (changes.reorder_point) {
        await base44.entities.Product.update(product.id, {
          min_before_reorder: changes.reorder_point.to,
        });
      }

      // Adjust on-hand via StockMovement (stocktake adjustment)
      if (changes.on_hand) {
        const variance = changes.on_hand.to - changes.on_hand.from;
        if (Math.abs(variance) > 0.001) {
          // Find any existing SOH record for this product first
          const allSoh = await base44.entities.StockOnHand.filter({
            product_id: product.id,
          });

          const locationId = allSoh.length > 0
            ? allSoh[0].location_id
            : (product.default_location_id || FALLBACK_LOCATION_ID);

          await base44.entities.StockMovement.create({
            product_id: product.id,
            product_sku: product.sku,
            product_name: product.name,
            qty: Math.abs(variance),
            uom: product.stock_uom || 'pcs',
            reason: 'stocktake_adjustment',
            ref_type: 'manual',
            reference_key: `csv_import:${product.sku}:${new Date().toISOString()}`,
            notes: `CSV import adjustment: ${changes.on_hand.from} → ${changes.on_hand.to}`,
            ...(variance > 0
              ? { to_location_id: locationId }
              : { from_location_id: locationId }
            ),
          });

          // Update or create StockOnHand record
          if (allSoh.length > 0) {
            const soh = allSoh[0];
            const newOnHand = changes.on_hand.to;
            const newAvailable = newOnHand - (soh.qty_committed || 0);
            await base44.entities.StockOnHand.update(soh.id, {
              qty_on_hand: newOnHand,
              qty_available: newAvailable,
              last_updated_at: new Date().toISOString(),
            });
          } else {
            // No SOH record exists — create one
            await base44.entities.StockOnHand.create({
              product_id: product.id,
              product_sku: product.sku,
              product_name: product.name,
              location_id: locationId,
              location_name: '',
              qty_on_hand: changes.on_hand.to,
              qty_committed: 0,
              qty_available: changes.on_hand.to,
              uom: product.stock_uom || 'pcs',
              last_updated_at: new Date().toISOString(),
            });
          }
        }
      }
    }

    toast.success(`${diffs.length} product(s) updated from CSV import.`);
    setImporting(false);
    onImportComplete?.();
    onClose();
  };

  const hasOnHandChanges = diffs.some(d => d.changes.on_hand);
  const hasReorderChanges = diffs.some(d => d.changes.reorder_point);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-xl max-w-3xl w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-bold">Review CSV Import</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {diffs.length} product{diffs.length !== 1 ? 's' : ''} with changes detected
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary + Parse warnings */}
        {parseErrors.length > 0 && (
          <div className="px-6 py-3 border-b border-border space-y-1">
            {/* First line is always the summary */}
            <p className="text-xs font-medium text-muted-foreground">{parseErrors[0]}</p>
            {parseErrors.length > 1 && (
              <div className="flex items-start gap-2 mt-1 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  {parseErrors.slice(1, 11).map((err, i) => (
                    <p key={i} className="text-xs text-amber-600 dark:text-amber-500">{err}</p>
                  ))}
                  {parseErrors.length > 11 && (
                    <p className="text-xs text-amber-600">...and {parseErrors.length - 11} more</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Diff table */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {diffs.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
              <p className="font-medium">No changes detected</p>
              <p className="text-sm text-muted-foreground mt-1">
                The CSV data matches the current inventory.
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">SKU</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Name</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Field</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Current</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground uppercase w-8"></th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">New</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {diffs.map((diff, idx) => {
                  const rows = [];
                  if (diff.changes.on_hand) {
                    rows.push({ field: 'On Hand', ...diff.changes.on_hand });
                  }
                  if (diff.changes.reorder_point) {
                    rows.push({ field: 'Reorder Pt', ...diff.changes.reorder_point });
                  }
                  return rows.map((row, rIdx) => (
                    <tr key={`${idx}-${rIdx}`} className="hover:bg-muted/20">
                      {rIdx === 0 && (
                        <>
                          <td className="px-3 py-2 text-sm font-mono font-medium" rowSpan={rows.length}>{diff.product.sku}</td>
                          <td className="px-3 py-2 text-sm" rowSpan={rows.length}>{diff.product.name}</td>
                        </>
                      )}
                      <td className="px-3 py-2 text-center">
                        <Badge variant="outline" className="text-[10px]">{row.field}</Badge>
                      </td>
                      <td className="px-3 py-2 text-sm text-right tabular-nums text-muted-foreground">
                        {typeof row.from === 'number' ? row.from.toLocaleString('en-ZA', { maximumFractionDigits: 2 }) : row.from}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground mx-auto" />
                      </td>
                      <td className="px-3 py-2 text-sm text-right tabular-nums font-medium text-primary">
                        {typeof row.to === 'number' ? row.to.toLocaleString('en-ZA', { maximumFractionDigits: 2 }) : row.to}
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/30">
          <div className="flex gap-2">
            {hasOnHandChanges && (
              <Badge className="bg-blue-100 text-blue-700 text-[10px]">Stock adjustments</Badge>
            )}
            {hasReorderChanges && (
              <Badge className="bg-purple-100 text-purple-700 text-[10px]">Reorder point updates</Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={importing}>Cancel</Button>
            <Button
              onClick={handleConfirm}
              disabled={importing || diffs.length === 0}
              className="gap-1.5"
            >
              {importing ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</>
              ) : (
                <><CheckCircle2 className="w-4 h-4" /> Confirm {diffs.length} Change{diffs.length !== 1 ? 's' : ''}</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}