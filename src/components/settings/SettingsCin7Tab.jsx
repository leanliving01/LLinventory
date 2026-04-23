import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Database, Wifi, Package, Users as UsersIcon, Boxes, Loader2, CheckCircle2, AlertCircle, ChefHat } from 'lucide-react';
import { toast } from 'sonner';

const importSteps = [
  { action: 'import_products', label: 'Products', description: 'Import all products from Cin7 with type mapping', icon: Package, fn: 'cin7Import' },
  { action: 'import_suppliers', label: 'Suppliers', description: 'Import supplier contacts and payment terms', icon: UsersIcon, fn: 'cin7Import' },
  { action: 'import_stock', label: 'Stock Levels', description: 'Import current stock on hand per location', icon: Boxes, fn: 'cin7Import' },
  { action: 'import', label: 'Recipes (BOMs)', description: 'Import Cook, Portion & Pack recipes — runs in batches', icon: ChefHat, fn: 'cin7BomImport', batched: true },
];

export default function SettingsCin7Tab() {
  const [testing, setTesting] = useState(false);
  const [connectionOk, setConnectionOk] = useState(null);
  const [running, setRunning] = useState(null);
  const [results, setResults] = useState({});
  const [batchProgress, setBatchProgress] = useState(null); // { processed, total }

  const handleTestConnection = async () => {
    setTesting(true);
    setConnectionOk(null);
    try {
      await base44.functions.invoke('cin7Import', { action: 'test' });
      setConnectionOk(true);
      toast.success('Connected to Cin7 successfully');
    } catch (err) {
      setConnectionOk(false);
      toast.error('Connection failed: ' + (err.response?.data?.error || err.message));
    }
    setTesting(false);
  };

  const handleImport = async (action) => {
    const step = importSteps.find(s => s.action === action);
    const fnName = step?.fn || 'cin7Import';
    setRunning(action);
    setBatchProgress(null);

    try {
      if (step?.batched) {
        // Run batched import — chain calls until has_more = false
        let offset = 0;
        let totals = { boms_created: 0, boms_updated: 0, components_created: 0, operations_created: 0, warnings: 0, errors: 0 };
        let totalItems = 0;
        let keepGoing = true;

        while (keepGoing) {
          const res = await base44.functions.invoke(fnName, { action, offset, batch_size: 20 });
          const d = res.data;
          totals.boms_created += d.boms_created || 0;
          totals.boms_updated += d.boms_updated || 0;
          totals.components_created += d.components_created || 0;
          totals.operations_created += d.operations_created || 0;
          totals.warnings += d.warnings || 0;
          totals.errors += d.errors || 0;
          totalItems = d.total_items || totalItems;

          const processed = Math.min(d.next_offset || (offset + 30), totalItems);
          setBatchProgress({ processed, total: totalItems });

          if (d.has_more) {
            offset = d.next_offset;
          } else {
            keepGoing = false;
          }
        }

        setResults(prev => ({ ...prev, [action]: totals }));
        toast.success(`${totals.boms_created} created, ${totals.boms_updated} updated, ${totals.components_created} components`);
      } else {
        // Single-call import
        const res = await base44.functions.invoke(fnName, { action });
        setResults(prev => ({ ...prev, [action]: res.data }));
        const d = res.data;
        const created = d.created || d.created_count || 0;
        const updated = d.updated || d.updated_count || 0;
        toast.success(`${created} created, ${updated} updated${d.errors ? `, ${d.errors} errors` : ''}`);
      }
    } catch (err) {
      toast.error('Import failed: ' + (err.response?.data?.error || err.message));
      setResults(prev => ({ ...prev, [action]: { error: true } }));
    }
    setRunning(null);
    setBatchProgress(null);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Connection test */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Database className="w-5 h-5 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Cin7 Core API Connection</h3>
            <p className="text-xs text-muted-foreground">
              Credentials stored in Base44 → Settings → Environment Variables.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={handleTestConnection} disabled={testing} variant="outline" size="sm" className="gap-2">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            Test Connection
          </Button>
          {connectionOk === true && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 className="w-4 h-4" /> Connected
            </span>
          )}
          {connectionOk === false && (
            <span className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="w-4 h-4" /> Failed — check credentials
            </span>
          )}
        </div>
      </div>

      {/* Import steps */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">Data Import</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Run imports in order. Each is idempotent — re-running updates existing records.</p>
        </div>
        <div className="divide-y divide-border">
          {importSteps.map((step, i) => {
            const result = results[step.action];
            const isRunning = running === step.action;
            return (
              <div key={step.action} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                      {i + 1}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{step.label}</p>
                      <p className="text-xs text-muted-foreground">{step.description}</p>
                      {result && !result.error && (
                        <p className="text-xs text-green-600 mt-0.5">
                          {result.boms_created || result.created || 0} created · {result.boms_updated || result.updated || 0} updated
                          {result.components_created ? ` · ${result.components_created} components` : ''}
                          {result.total ? ` · ${result.total} total` : ''}
                          {result.errors > 0 && <span className="text-red-500"> · {result.errors} errors</span>}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    onClick={() => handleImport(step.action)}
                    disabled={isRunning || (running && running !== step.action)}
                    size="sm"
                    className="gap-2"
                  >
                    {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <step.icon className="w-3.5 h-3.5" />}
                    {isRunning ? 'Importing...' : 'Run Import'}
                  </Button>
                </div>
                {/* Batch progress bar */}
                {isRunning && batchProgress && (
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Processing batch...</span>
                      <span>{batchProgress.processed} / {batchProgress.total}</span>
                    </div>
                    <Progress value={batchProgress.total > 0 ? (batchProgress.processed / batchProgress.total) * 100 : 0} className="h-2" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}