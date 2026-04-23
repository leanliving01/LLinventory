import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Database, Wifi, Package, Users as UsersIcon, Boxes, Loader2, CheckCircle2, AlertCircle, ChefHat } from 'lucide-react';
import { toast } from 'sonner';

const importSteps = [
  { action: 'import_products', label: 'Products', description: 'Import all 422 products from Cin7 with type mapping', icon: Package, fn: 'cin7Import' },
  { action: 'import_suppliers', label: 'Suppliers', description: 'Import supplier contacts and payment terms', icon: UsersIcon, fn: 'cin7Import' },
  { action: 'import_stock', label: 'Stock Levels', description: 'Import current stock on hand per location', icon: Boxes, fn: 'cin7Import' },
  { action: 'import', label: 'Recipes (BOMs)', description: 'Import Cook, Portion, and Pack recipes from Cin7 — Assembly + Production BOMs', icon: ChefHat, fn: 'cin7BomImport' },
];

export default function SettingsCin7Tab() {
  const [testing, setTesting] = useState(false);
  const [connectionOk, setConnectionOk] = useState(null);
  const [running, setRunning] = useState(null);
  const [results, setResults] = useState({});

  const handleTestConnection = async () => {
    setTesting(true);
    setConnectionOk(null);
    try {
      const res = await base44.functions.invoke('cin7Import', { action: 'test' });
      setConnectionOk(true);
      toast.success('Connected to Cin7 successfully');
    } catch (err) {
      setConnectionOk(false);
      toast.error('Connection failed: ' + (err.response?.data?.error || err.message));
    }
    setTesting(false);
  };

  const handleImport = async (action) => {
    setRunning(action);
    try {
      const step = importSteps.find(s => s.action === action);
      const fnName = step?.fn || 'cin7Import';
      const res = await base44.functions.invoke(fnName, { action });
      setResults(prev => ({ ...prev, [action]: res.data }));
      const d = res.data;
      const created = d.created || d.created_count || d.boms_created || 0;
      const updated = d.updated || d.updated_count || d.boms_updated || 0;
      toast.success(`${created} created, ${updated} updated${d.errors ? `, ${d.errors} errors` : ''}`);
    } catch (err) {
      toast.error('Import failed: ' + (err.response?.data?.error || err.message));
      setResults(prev => ({ ...prev, [action]: { error: true } }));
    }
    setRunning(null);
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
              Credentials are stored securely in environment variables. Set CIN7_ACCOUNT_ID and CIN7_APPLICATION_KEY in the Base44 dashboard → Settings → Environment Variables.
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
              <div key={step.action} className="px-6 py-4 flex items-center justify-between">
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
            );
          })}
        </div>
      </div>
    </div>
  );
}