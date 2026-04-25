import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const SYNC_CONFIGS = {
  shopify_orders: { label: 'Orders', fn: 'bulkSyncOrders' },
  shopify_products: { label: 'Products', fn: 'bulkSyncProducts' },
  shopify_customers: { label: 'Customers', fn: 'bulkSyncCustomers' },
};

function SyncRow({ syncKey, syncState, onTrigger, triggering }) {
  const config = SYNC_CONFIGS[syncKey];
  const isRunning = syncState?.sync_status === 'running';
  const isError = syncState?.sync_status === 'error';
  const hasResumeCursor = !!syncState?.last_cursor;
  const lastSync = syncState?.last_sync_at;
  const progress = syncState?.error_message || '';

  const buttonLabel = isRunning ? 'Running' : hasResumeCursor ? 'Resume' : 'Sync';

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex items-center gap-2 w-24 shrink-0">
        {isRunning ? (
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
        ) : isError ? (
          <AlertCircle className="w-4 h-4 text-destructive" />
        ) : hasResumeCursor ? (
          <AlertCircle className="w-4 h-4 text-amber-500" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-green-500" />
        )}
        <span className="text-sm font-medium">{config.label}</span>
      </div>

      <div className="flex-1 min-w-0">
        {isRunning ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground truncate">
              Syncing... {syncState.records_synced || 0} processed
              {syncState.records_failed > 0 && ` (${syncState.records_failed} failed)`}
            </p>
          </div>
        ) : isError ? (
          <p className="text-xs text-destructive truncate">{syncState.error_message}</p>
        ) : hasResumeCursor ? (
          <p className="text-xs text-amber-600">
            Paused at {syncState.records_synced || 0} records — press Resume to continue
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {lastSync ? `Last: ${new Date(lastSync).toLocaleString('en-ZA')}` : 'Never synced'}
            {syncState?.records_synced > 0 && ` · ${syncState.records_synced} records`}
          </p>
        )}
      </div>

      <Button
        size="sm"
        variant="outline"
        disabled={isRunning || triggering}
        onClick={() => onTrigger(syncKey)}
        className="shrink-0"
      >
        <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRunning ? 'animate-spin' : ''}`} />
        {buttonLabel}
      </Button>
    </div>
  );
}

export default function SyncStatusBanner({ showAll = false, syncKeys: customKeys }) {
  const [triggering, setTriggering] = useState(null);

  // Poll SyncState every 3 seconds while any sync is running, otherwise every 15s
  const { data: syncStates = [] } = useQuery({
    queryKey: ['sync-states'],
    queryFn: () => base44.entities.SyncState.filter({}),
    refetchInterval: (query) => {
      const states = query.state.data || [];
      const anyRunning = states.some(s => s.sync_status === 'running');
      return anyRunning ? 3000 : 15000;
    },
  });

  // Also subscribe to real-time updates
  useEffect(() => {
    const unsub = base44.entities.SyncState.subscribe((event) => {
      // React Query will refetch automatically on next interval, but we can force it
    });
    return unsub;
  }, []);

  const stateMap = {};
  for (const s of syncStates) {
    stateMap[s.source_key] = s;
  }

  const handleTrigger = async (syncKey) => {
    const config = SYNC_CONFIGS[syncKey];
    setTriggering(syncKey);
    try {
      const res = await base44.functions.invoke(config.fn, {});
      if (res.data?.status === 'already_running') {
        toast.info(`${config.label} sync is already running`);
      } else if (res.data?.status === 'completed') {
        toast.success(`${config.label} sync completed: ${res.data.created || 0} new, ${res.data.updated || 0} updated`);
      }
    } catch (err) {
      toast.error(`${config.label} sync failed: ${err.message}`);
    } finally {
      setTriggering(null);
    }
  };

  const keys = customKeys
    ? customKeys
    : showAll
      ? Object.keys(SYNC_CONFIGS)
      : ['shopify_orders'];

  const anyRunning = keys.some(k => stateMap[k]?.sync_status === 'running');

  return (
    <div className="bg-card border rounded-xl px-4 py-3">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-foreground">Shopify Sync</h3>
        {anyRunning && (
          <span className="text-xs text-primary flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Syncing...
          </span>
        )}
      </div>
      <div className="divide-y divide-border">
        {keys.map(k => (
          <SyncRow
            key={k}
            syncKey={k}
            syncState={stateMap[k]}
            onTrigger={handleTrigger}
            triggering={triggering === k}
          />
        ))}
      </div>
    </div>
  );
}