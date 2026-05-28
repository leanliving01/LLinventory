import React, { useState } from 'react';
import { supabase } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { RefreshCw, Eye, Loader2, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';

export default function RecalcCommittedStock() {
  const [running, setRunning] = useState(false);
  const [dryRunResult, setDryRunResult] = useState(null);

  const handleRecalc = async (dryRun) => {
    setRunning(true);
    setDryRunResult(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('recalc-committed-stock', { body: { dry_run: dryRun } });
      if (fnErr) throw new Error(fnErr.message);

      if (dryRun) {
        setDryRunResult(data);
        toast.success(`Dry run complete — ${data.unique_skus} SKUs computed in ${data.elapsed_seconds}s`);
      } else {
        toast.success(
          `Committed stock recalculated — ${data.orders_processed} orders, ${data.unique_skus} SKUs updated in ${data.elapsed_seconds}s`
        );
        if (data.errors?.length > 0) {
          toast.warning(`${data.errors.length} error(s) encountered — check details`);
        }
      }
    } catch (err) {
      toast.error('Recalculation failed: ' + (err.message || 'Unknown error'));
    } finally {
      setRunning(false);
    }
  };

  // Sort dry run results by committed qty descending
  const sortedCommitted = dryRunResult?.committed_quantities
    ? Object.entries(dryRunResult.committed_quantities).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Full Recalc Button */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="default" size="sm" disabled={running} className="gap-1.5">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Recalculate Committed Stock
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Recalculate Committed Stock</AlertDialogTitle>
              <AlertDialogDescription>
                This will recalculate committed stock for ALL products based on current orders and PackBom definitions. 
                Existing SalesOrderLine records will not be modified.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => handleRecalc(false)}>
                Continue
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Dry Run Button */}
        <Button
          variant="outline"
          size="sm"
          disabled={running}
          onClick={() => handleRecalc(true)}
          className="gap-1.5"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          Dry Run
        </Button>

        {running && (
          <span className="text-xs text-muted-foreground">Recalculating committed stock…</span>
        )}
      </div>

      {/* Dry Run Results */}
      {dryRunResult && (
        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span className="text-sm font-medium">Dry Run Results</span>
              <Badge variant="secondary" className="text-xs">
                {dryRunResult.orders_processed} orders · {dryRunResult.unique_skus} SKUs · {dryRunResult.elapsed_seconds}s
              </Badge>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDryRunResult(null)}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>

          {dryRunResult.warnings?.length > 0 && (
            <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b">
              {dryRunResult.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {w}
                </p>
              ))}
            </div>
          )}

          <div className="max-h-80 overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-muted/50">
                <tr className="border-b">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">SKU</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Committed Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedCommitted.map(([sku, qty]) => (
                  <tr key={sku} className="hover:bg-muted/30">
                    <td className="px-4 py-1.5 text-sm font-mono">{sku}</td>
                    <td className="px-4 py-1.5 text-sm text-right tabular-nums font-medium">{qty}</td>
                  </tr>
                ))}
                {sortedCommitted.length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-4 py-4 text-center text-sm text-muted-foreground">
                      No committed stock found for any SKU.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}