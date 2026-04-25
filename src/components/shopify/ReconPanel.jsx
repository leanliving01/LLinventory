import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield, Loader2, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

export default function ReconPanel() {
  const [running, setRunning] = useState(false);
  const [scope, setScope] = useState('orders');
  const [autoCorrect, setAutoCorrect] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const queryClient = useQueryClient();

  const { data: mismatches = [], isLoading } = useQuery({
    queryKey: ['recon-mismatches'],
    queryFn: () => base44.entities.ReconciliationMismatch.list('-detected_at', 100),
  });

  const unresolvedMismatches = mismatches.filter(m => !m.resolved_at);

  const handleRun = async () => {
    setRunning(true);
    setLastResult(null);
    try {
      const res = await base44.functions.invoke('reconcileShopify', { scope, auto_correct: autoCorrect });
      setLastResult(res.data);
      queryClient.invalidateQueries({ queryKey: ['recon-mismatches'] });
      if (res.data.mismatches_found === 0) {
        toast.success('No mismatches found — data is in sync!');
      } else {
        toast.warning(`Found ${res.data.mismatches_found} mismatches${res.data.auto_corrected > 0 ? `, auto-corrected ${res.data.auto_corrected}` : ''}`);
      }
    } catch (err) {
      toast.error('Reconciliation failed: ' + err.message);
    } finally {
      setRunning(false);
    }
  };

  const handleClearResolved = async () => {
    const resolved = mismatches.filter(m => m.resolved_at || m.auto_corrected);
    for (const m of resolved) {
      await base44.entities.ReconciliationMismatch.delete(m.id);
    }
    queryClient.invalidateQueries({ queryKey: ['recon-mismatches'] });
    toast.success(`Cleared ${resolved.length} resolved mismatches`);
  };

  return (
    <div className="bg-card border rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold">Reconciliation</h3>
          {unresolvedMismatches.length > 0 && (
            <Badge variant="destructive" className="text-xs">{unresolvedMismatches.length} issues</Badge>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="orders">Orders</SelectItem>
            <SelectItem value="products">Products</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoCorrect}
            onChange={e => setAutoCorrect(e.target.checked)}
            className="rounded"
          />
          Auto-correct
        </label>

        <Button size="sm" onClick={handleRun} disabled={running}>
          {running ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Shield className="w-4 h-4 mr-1.5" />}
          {running ? 'Checking...' : 'Run Recon'}
        </Button>

        {mismatches.some(m => m.resolved_at || m.auto_corrected) && (
          <Button size="sm" variant="ghost" onClick={handleClearResolved}>
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear resolved
          </Button>
        )}
      </div>

      {/* Last result */}
      {lastResult && (
        <div className={`text-sm p-3 rounded-lg ${lastResult.mismatches_found === 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          {lastResult.mismatches_found === 0 ? (
            <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> All data in sync!</span>
          ) : (
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              {lastResult.mismatches_found} mismatches found
              {lastResult.auto_corrected > 0 && `, ${lastResult.auto_corrected} auto-corrected`}
            </span>
          )}
        </div>
      )}

      {/* Mismatch list */}
      {unresolvedMismatches.length > 0 && (
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {unresolvedMismatches.slice(0, 15).map(m => (
            <div key={m.id} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded bg-muted/50">
              <Badge variant="outline" className="text-xs shrink-0">{m.entity_type}</Badge>
              <span className="text-muted-foreground shrink-0">{m.field}</span>
              <span className="truncate">
                Shopify: <strong>{m.shopify_value}</strong> → Base44: <strong>{m.base44_value}</strong>
              </span>
              {m.auto_corrected && <Badge className="bg-green-100 text-green-700 text-xs">Fixed</Badge>}
            </div>
          ))}
          {unresolvedMismatches.length > 15 && (
            <p className="text-xs text-muted-foreground px-2">...and {unresolvedMismatches.length - 15} more</p>
          )}
        </div>
      )}
    </div>
  );
}