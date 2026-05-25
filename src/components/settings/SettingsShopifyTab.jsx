import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ShoppingBag, RefreshCw, Package, ShoppingCart, CheckCircle2, AlertCircle, Loader2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTimeSAST } from '@/lib/dateUtils';

const SYNC_KEYS = {
  products: 'shopify_products',
  orders: 'shopify_orders',
};

function SyncStatusBadge({ status }) {
  if (status === 'running') return <Badge className="bg-blue-100 text-blue-700 border-blue-200 gap-1"><Loader2 className="w-3 h-3 animate-spin" />Running</Badge>;
  if (status === 'error') return <Badge className="bg-red-100 text-red-700 border-red-200 gap-1"><AlertCircle className="w-3 h-3" />Error</Badge>;
  if (status === 'idle') return <Badge className="bg-green-100 text-green-700 border-green-200 gap-1"><CheckCircle2 className="w-3 h-3" />Ready</Badge>;
  return <Badge variant="outline">Unknown</Badge>;
}

export default function SettingsShopifyTab() {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(null); // 'products_incremental' | 'products_full' | 'orders'
  const [savingToggle, setSavingToggle] = useState(null);

  // Fetch sync states for products and orders
  const { data: syncStates = {} } = useQuery({
    queryKey: ['shopify-sync-states'],
    queryFn: async () => {
      const { data } = await supabase
        .from('sync_states')
        .select('source_key, sync_status, last_sync_at, records_synced, error_message')
        .in('source_key', Object.values(SYNC_KEYS));
      const map = {};
      for (const row of data || []) map[row.source_key] = row;
      return map;
    },
    refetchInterval: 5000, // poll every 5s to catch running → idle transitions
  });

  // Fetch source-of-truth settings
  const { data: settings = [] } = useQuery({
    queryKey: ['shopify-settings'],
    queryFn: () => base44.entities.Setting.filter({ group: 'shopify' }, 'key', 50),
  });

  const settingByKey = {};
  settings.forEach(s => { settingByKey[s.key] = s; });

  const getToggle = (key, defaultVal) => {
    const s = settingByKey[key];
    if (!s) return defaultVal;
    return s.value === 'true';
  };

  const handleToggle = async (key, label, newVal) => {
    setSavingToggle(key);
    const existing = settingByKey[key];
    if (existing) {
      await base44.entities.Setting.update(existing.id, { value: String(newVal) });
    } else {
      await base44.entities.Setting.create({ key, value: String(newVal), group: 'shopify', label });
    }
    queryClient.invalidateQueries({ queryKey: ['shopify-settings'] });
    setSavingToggle(null);
    toast.success(`${label} ${newVal ? 'enabled' : 'disabled'}`);
  };

  const handleSync = async (type) => {
    setRunning(type);
    try {
      if (type === 'products_incremental') {
        const { data, error } = await supabase.functions.invoke('sync-shopify-products', { body: { mode: 'start' } });
        if (error) throw error;
        toast.success('Product sync started — running in background');
      } else if (type === 'products_full') {
        const { data, error } = await supabase.functions.invoke('sync-shopify-products', { body: { mode: 'start', fullResync: true } });
        if (error) throw error;
        toast.success('Full product resync started — running in background');
      } else if (type === 'orders') {
        await base44.functions.invoke('bulkSyncOrders', { mode: 'start' });
        toast.success('Order sync started');
      }
      // Refresh sync states after a short delay
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['shopify-sync-states'] }), 2000);
    } catch (err) {
      toast.error(`Sync failed: ${err.message || 'Unknown error'}`);
    }
    setRunning(null);
  };

  const productState = syncStates[SYNC_KEYS.products];
  const orderState = syncStates[SYNC_KEYS.orders];
  const isProductRunning = productState?.sync_status === 'running';
  const isOrderRunning = orderState?.sync_status === 'running';

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Connection Status */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Shopify Connection</h3>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
          <span>Connected via API credentials in environment — credentials are configured server-side and not editable here.</span>
        </div>
        <div className="grid grid-cols-2 gap-4 pt-1">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Products Sync</p>
            <div className="flex items-center gap-2">
              <SyncStatusBadge status={productState?.sync_status || 'idle'} />
              {productState?.records_synced > 0 && (
                <span className="text-xs text-muted-foreground">{productState.records_synced.toLocaleString()} synced</span>
              )}
            </div>
            {productState?.last_sync_at && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> {formatDateTimeSAST(productState.last_sync_at)}
              </p>
            )}
            {productState?.error_message && (
              <p className="text-xs text-red-600 truncate" title={productState.error_message}>{productState.error_message}</p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Orders Sync</p>
            <div className="flex items-center gap-2">
              <SyncStatusBadge status={orderState?.sync_status || 'idle'} />
              {orderState?.records_synced > 0 && (
                <span className="text-xs text-muted-foreground">{orderState.records_synced.toLocaleString()} synced</span>
              )}
            </div>
            {orderState?.last_sync_at && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> {formatDateTimeSAST(orderState.last_sync_at)}
              </p>
            )}
            {orderState?.error_message && (
              <p className="text-xs text-red-600 truncate" title={orderState.error_message}>{orderState.error_message}</p>
            )}
          </div>
        </div>
      </div>

      {/* Product Sync */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Product Sync</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Syncs product names, SKUs, and barcodes from Shopify. Also keeps the meal library (par levels, pack compositions) up to date with new meals. BOMs and stock levels are never overwritten.
        </p>

        <div className="space-y-3">
          {/* Incremental */}
          <div className="flex items-start justify-between gap-4 p-3 rounded-lg border bg-muted/30">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Sync Products (Incremental)</p>
              <p className="text-xs text-muted-foreground">Only products updated since the last sync. Fast and safe to run anytime.</p>
            </div>
            <Button
              size="sm"
              onClick={() => handleSync('products_incremental')}
              disabled={!!running || isProductRunning}
              className="shrink-0 gap-1.5"
            >
              {(running === 'products_incremental' || isProductRunning) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {isProductRunning ? 'Running...' : 'Sync Now'}
            </Button>
          </div>

          {/* Full Resync */}
          <div className="flex items-start justify-between gap-4 p-3 rounded-lg border bg-muted/30">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Full Product Resync</p>
              <p className="text-xs text-muted-foreground">Fetches all products regardless of update date. Use after renaming products or changing SKUs in Shopify.</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleSync('products_full')}
              disabled={!!running || isProductRunning}
              className="shrink-0 gap-1.5"
            >
              {running === 'products_full' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Full Resync
            </Button>
          </div>
        </div>
      </div>

      {/* Order Sync */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Order Sync</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Imports recent Shopify orders into the system for fulfilment tracking, demand calculation, and packing.
        </p>
        <div className="flex items-start justify-between gap-4 p-3 rounded-lg border bg-muted/30">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Sync Recent Orders</p>
            <p className="text-xs text-muted-foreground">Pulls orders from the last 14 days and recalculates meal demand.</p>
          </div>
          <Button
            size="sm"
            onClick={() => handleSync('orders')}
            disabled={!!running || isOrderRunning}
            className="shrink-0 gap-1.5"
          >
            {(running === 'orders' || isOrderRunning) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {isOrderRunning ? 'Running...' : 'Sync Orders'}
          </Button>
        </div>
      </div>

      {/* Source of Truth Settings */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h3 className="font-semibold">Source of Truth</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Control how Shopify data interacts with this system.</p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="toggle-name-source" className="text-sm font-medium">Product names come from Shopify</Label>
              <p className="text-xs text-muted-foreground">When on, syncing will overwrite product names in this system with the Shopify name. Turn off to manage names locally.</p>
            </div>
            <Switch
              id="toggle-name-source"
              checked={getToggle('shopify_product_name_source', true)}
              disabled={savingToggle === 'shopify_product_name_source'}
              onCheckedChange={(val) => handleToggle('shopify_product_name_source', 'Product names from Shopify', val)}
            />
          </div>

          <div className="flex items-center justify-between gap-4 opacity-60">
            <div className="space-y-0.5">
              <Label htmlFor="toggle-push-stock" className="text-sm font-medium">Push stock levels back to Shopify</Label>
              <p className="text-xs text-muted-foreground">Coming soon — will update Shopify inventory quantities from this system after each cook run.</p>
            </div>
            <Switch
              id="toggle-push-stock"
              checked={false}
              disabled
            />
          </div>
        </div>
      </div>

    </div>
  );
}
