import React, { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2, AlertCircle, Loader2, Pause, X, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

const SYNC_CONFIGS = {
  shopify_orders:       { label: 'Orders',         fn: 'bulkSyncOrders',         title: 'Shopify Sync' },
  shopify_products:     { label: 'Products',       fn: 'bulkSyncProducts',       title: 'Shopify Sync' },
  shopify_customers:    { label: 'Customers',      fn: 'bulkSyncCustomers',      title: 'Shopify Sync' },
  xero_invoices:        { label: 'Bills (Xero)',   fn: 'syncXeroInvoices',       title: 'Xero Sync' },
  xero_purchase_orders: { label: 'POs (Xero)',     fn: 'syncXeroPurchaseOrders', title: 'Xero Sync' },
};

function SyncRow({ syncKey, syncState, onTrigger, onCancel, triggering, onFullResync, onSinceDays }) {
  const config = SYNC_CONFIGS[syncKey];
  const isRunning = syncState?.sync_status === 'running';
  const isCancelling = syncState?.sync_status === 'cancelling';
  const isError = syncState?.sync_status === 'error';
  const isRateLimited = isRunning && (syncState?.error_message || '').includes('rate_limited');
  const lastSync = syncState?.last_sync_at;

  let icon;
  if (isCancelling) icon = <Pause className="w-4 h-4 text-amber-500" />;
  else if (isRunning) icon = <Loader2 className="w-4 h-4 text-primary animate-spin" />;
  else if (isError) icon = <AlertCircle className="w-4 h-4 text-destructive" />;
  else icon = <CheckCircle2 className="w-4 h-4 text-green-500" />;

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex items-center gap-2 w-32 shrink-0">
        {icon}
        <span className="text-sm font-medium">{config.label}</span>
      </div>

      <div className="flex-1 min-w-0">
        {isRunning ? (
          <p className="text-xs text-muted-foreground truncate">
            {isRateLimited ? 'Paused — waiting on rate limit…' : 'Syncing…'} {syncState.records_synced || 0} processed
            {syncState.records_failed > 0 && ` (${syncState.records_failed} failed)`}
          </p>
        ) : isCancelling ? (
          <p className="text-xs text-amber-700 truncate">Cancelling…</p>
        ) : isError ? (
          <p className="text-xs text-destructive truncate">{syncState.error_message}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {lastSync ? `Last: ${new Date(lastSync).toLocaleString('en-ZA')}` : 'Never synced'}
            {syncState?.records_synced > 0 && ` · ${syncState.records_synced} records`}
          </p>
        )}
      </div>

      {isRunning ? (
        <Button size="sm" variant="outline" onClick={() => onCancel(syncKey)} className="shrink-0 text-destructive hover:text-destructive">
          <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
        </Button>
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="outline" disabled={triggering} onClick={() => onTrigger(syncKey)}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${triggering ? 'animate-spin' : ''}`} />
            {triggering ? 'Starting…' : 'Sync'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="px-2">
                <MoreVertical className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onSinceDays(syncKey, 30)}>
                Sync last 30 days
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSinceDays(syncKey, 90)}>
                Sync last 90 days
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onFullResync(syncKey)}>
                Full re-sync (everything from scratch)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

export default function SyncStatusBanner({ showAll = false, syncKeys: customKeys, title }) {
  const [triggering, setTriggering] = useState(null);

  const { data: syncStates = [] } = useQuery({
    queryKey: ['sync-states'],
    queryFn: () => base44.entities.SyncState.filter({}),
    refetchInterval: (query) => {
      const states = query.state.data || [];
      const anyActive = states.some(s => s.sync_status === 'running' || s.sync_status === 'cancelling');
      return anyActive ? 3000 : 15000;
    },
  });

  useEffect(() => {
    const unsub = base44.entities.SyncState.subscribe(() => {});
    return unsub;
  }, []);

  // Safety net — if a sync row stays at the same records_synced count for
  // 30s while sync_status='running', the chain has likely broken. Re-trigger
  // mode='continue' so it resumes from the saved cursor.
  const stuckRef = useRef({}); // { source_key: { count, lastChangedAt, retrying } }
  useEffect(() => {
    const now = Date.now();
    for (const s of syncStates) {
      if (s.sync_status !== 'running') {
        delete stuckRef.current[s.source_key];
        continue;
      }
      const tracking = stuckRef.current[s.source_key] || { count: -1, lastChangedAt: 0, retrying: false };
      if (s.records_synced !== tracking.count) {
        stuckRef.current[s.source_key] = { count: s.records_synced, lastChangedAt: now, retrying: false };
      } else if (now - tracking.lastChangedAt > 30000 && !tracking.retrying) {
        // Stuck — re-trigger
        const config = SYNC_CONFIGS[s.source_key];
        if (config) {
          stuckRef.current[s.source_key] = { ...tracking, retrying: true, lastChangedAt: now };
          base44.functions.invoke(config.fn, { mode: 'continue' }).catch(() => {});
        }
      }
    }
  }, [syncStates]);

  const stateMap = {};
  for (const s of syncStates) stateMap[s.source_key] = s;

  const handleTrigger = async (syncKey, fullResync = false, sinceDate = null) => {
    const config = SYNC_CONFIGS[syncKey];
    setTriggering(syncKey);
    const payload = { mode: 'start', fullResync };
    if (sinceDate) payload.sinceDate = sinceDate;
    try {
      const res = await base44.functions.invoke(config.fn, payload);
      if (res.data?.status === 'error' || res.data?.error) {
        toast.error(`${config.label}: ${res.data?.error || res.data?.status || 'sync failed'}`);
      } else if (res.data?.status === 'completed') {
        toast.success(`${config.label}: ${res.data.totalProcessed || 0} records synced`);
      } else {
        toast.info(`${config.label} ${fullResync ? 'full re-sync' : 'sync'} started…`);
      }
    } catch (err) {
      toast.error(`${config.label} sync failed: ${err.message}`);
    } finally {
      setTriggering(null);
    }
  };

  const handleSinceDays = (syncKey, days) => {
    const since = new Date();
    since.setDate(since.getDate() - days);
    handleTrigger(syncKey, true, since.toISOString());
  };

  const handleFullResync = (syncKey) => {
    if (window.confirm('Pull everything from scratch? This will re-fetch all records (slower) instead of just new/changed ones since last sync.')) {
      handleTrigger(syncKey, true, null);
    }
  };

  const handleCancel = async (syncKey) => {
    const config = SYNC_CONFIGS[syncKey];
    try {
      await base44.functions.invoke(config.fn, { mode: 'cancel' });
      toast.info(`${config.label} sync cancelling…`);
    } catch (err) {
      toast.error(`Cancel failed: ${err.message}`);
    }
  };

  const keys = customKeys
    ? customKeys
    : showAll
      ? Object.keys(SYNC_CONFIGS)
      : ['shopify_orders'];

  const bannerTitle = title || SYNC_CONFIGS[keys[0]]?.title || 'Sync';
  const anyRunning = keys.some(k => stateMap[k]?.sync_status === 'running');

  return (
    <div className="bg-card border rounded-xl px-4 py-3">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-foreground">{bannerTitle}</h3>
        {anyRunning && (
          <span className="text-xs text-primary flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Syncing…
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
            onCancel={handleCancel}
            onFullResync={handleFullResync}
            onSinceDays={handleSinceDays}
            triggering={triggering === k}
          />
        ))}
      </div>
    </div>
  );
}
