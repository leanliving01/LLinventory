import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, PlayCircle, StopCircle, CheckCircle2, AlertCircle, Clock, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import SyncHealthIndicator from '@/components/shared/SyncHealthIndicator';
import { differenceInMinutes, format } from 'date-fns';

const SOURCES = [
  { key: 'shopify_orders', label: 'Shopify Orders', fn: 'sync-shopify-orders', description: 'Sales orders from your Shopify store' },
  { key: 'shopify_products', label: 'Shopify Products', fn: 'sync-shopify-products', description: 'Product catalogue and SKU metadata' },
  { key: 'xero_invoices', label: 'Xero Bills (ACCPAY)', fn: 'sync-xero-invoices', description: 'Supplier invoices from Xero accounting' },
  { key: 'xero_purchase_orders', label: 'Xero Purchase Orders', fn: 'sync-xero-purchase-orders', description: 'POs created or managed in Xero' },
];

function StatusBadge({ state }) {
  if (!state) return <Badge className="bg-gray-100 text-gray-600 text-[10px]">Never synced</Badge>;
  if (state.sync_status === 'running') return <Badge className="bg-blue-100 text-blue-700 text-[10px]">Running</Badge>;
  if (state.sync_status === 'error') return <Badge className="bg-red-100 text-red-600 text-[10px]">Error</Badge>;
  return <Badge className="bg-green-100 text-green-700 text-[10px]">Idle</Badge>;
}

export default function SettingsSyncTab() {
  const queryClient = useQueryClient();
  const [triggering, setTriggering] = useState({});
  const [registeringWebhooks, setRegisteringWebhooks] = useState(false);
  const [webhookResult, setWebhookResult] = useState(null);

  const { data: syncStates = [], refetch } = useQuery({
    queryKey: ['sync-states'],
    queryFn: () => base44.entities.SyncState.list('source_key', 20),
    refetchInterval: 15000,
    staleTime: 5000,
  });

  const stateByKey = Object.fromEntries(syncStates.map(s => [s.source_key, s]));

  const triggerSync = async (src, fullResync = false) => {
    setTriggering(prev => ({ ...prev, [src.key]: true }));
    try {
      const res = await base44.functions.invoke(src.fn, { mode: 'start', fullResync });
      if (res?.status === 'error') {
        toast.error(`${src.label}: ${res.error}`);
      } else {
        toast.success(`${src.label} sync started`);
      }
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['sync-logs'] });
    } catch (err) {
      toast.error(`Failed to trigger ${src.label}: ${err.message}`);
    }
    setTriggering(prev => ({ ...prev, [src.key]: false }));
  };

  const registerWebhooks = async () => {
    setRegisteringWebhooks(true);
    setWebhookResult(null);
    try {
      const res = await base44.functions.invoke('register-shopify-webhooks', {});
      setWebhookResult(res);
      const allOk = res?.results?.every(r => r.status !== 'error');
      if (allOk) {
        toast.success('Shopify webhooks registered successfully');
      } else {
        toast.error('Some webhooks failed to register — check results below');
      }
    } catch (err) {
      toast.error(`Webhook registration failed: ${err.message}`);
    }
    setRegisteringWebhooks(false);
  };

  const cancelSync = async (src) => {
    setTriggering(prev => ({ ...prev, [src.key]: true }));
    try {
      await base44.functions.invoke(src.fn, { mode: 'cancel' });
      toast.success(`${src.label} cancelled`);
      await refetch();
    } catch (err) {
      toast.error(`Failed to cancel: ${err.message}`);
    }
    setTriggering(prev => ({ ...prev, [src.key]: false }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Sync Health</h3>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">Current status of all data sources</p>
        <SyncHealthIndicator />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Manual Sync Controls</h3>
        <p className="text-xs text-muted-foreground">
          Syncs run automatically on schedule. Use these controls to trigger immediately or force a full resync.
          Xero is read-only — no data is pushed from this system.
        </p>

        {SOURCES.map(src => {
          const state = stateByKey[src.key];
          const isRunning = state?.sync_status === 'running';
          const isBusy = !!triggering[src.key];
          const lastSync = state?.last_sync_at ? format(new Date(state.last_sync_at), 'dd/MM/yy HH:mm') : 'Never';
          const ageMin = state?.last_sync_at ? differenceInMinutes(new Date(), new Date(state.last_sync_at)) : null;

          return (
            <div key={src.key} className="bg-card rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-medium">{src.label}</p>
                    <StatusBadge state={state} />
                  </div>
                  <p className="text-xs text-muted-foreground">{src.description}</p>
                  <div className="flex gap-4 mt-1.5 text-[11px] text-muted-foreground">
                    <span>Last sync: {lastSync}</span>
                    {ageMin != null && <span>{ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ${ageMin % 60}m ago`}</span>}
                    {state?.records_synced > 0 && <span>{state.records_synced.toLocaleString()} records</span>}
                  </div>
                  {state?.error_message && (
                    <p className="text-[11px] text-red-600 mt-1 font-mono">{state.error_message}</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {isRunning ? (
                    <Button variant="outline" size="sm" onClick={() => cancelSync(src)} disabled={isBusy} className="gap-1.5 h-8 text-xs text-destructive border-destructive/40">
                      <StopCircle className="w-3.5 h-3.5" /> Cancel
                    </Button>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" onClick={() => triggerSync(src, false)} disabled={isBusy} className="gap-1.5 h-8 text-xs">
                        {isBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                        Sync Now
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => triggerSync(src, true)} disabled={isBusy} className="gap-1.5 h-8 text-xs text-muted-foreground">
                        Full Resync
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Shopify Webhooks</h3>
        <p className="text-xs text-muted-foreground">
          Register webhooks so Shopify pushes order events in real time. This complements the 5-minute polling.
          Run once after initial setup, or if the handler URL changes.
        </p>
        <Button variant="outline" size="sm" onClick={registerWebhooks} disabled={registeringWebhooks} className="gap-2">
          {registeringWebhooks ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Webhook className="w-3.5 h-3.5" />}
          Register Webhooks
        </Button>
        {webhookResult?.results && (
          <div className="mt-2 space-y-1">
            {webhookResult.results.map(r => (
              <div key={r.topic} className="flex items-center gap-2 text-xs">
                {r.status === 'error'
                  ? <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />
                  : <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />}
                <span className="font-mono">{r.topic}</span>
                <span className="text-muted-foreground">{r.status}{r.webhookId ? ` (#${r.webhookId})` : ''}</span>
                {r.error && <span className="text-red-500 truncate">{r.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-muted/40 rounded-lg border border-border p-4 text-sm space-y-2">
        <p className="font-medium">Automatic Schedule</p>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>• <strong>Shopify Orders:</strong> Every 5 minutes via external cron (Render/Railway/GitHub Actions)</li>
          <li>• <strong>Xero Bills:</strong> Every 4 hours via scheduled trigger</li>
          <li>• <strong>Shopify Products:</strong> Triggered on demand or nightly</li>
          <li>• <strong>Daily reconciliation:</strong> 02:00 SAST — re-syncs last 7 days from Shopify</li>
        </ul>
        <p className="text-xs text-muted-foreground pt-1">
          External cron script: <code className="font-mono bg-muted px-1 rounded text-[11px]">scripts/cron-trigger.js</code>
        </p>
      </div>
    </div>
  );
}
