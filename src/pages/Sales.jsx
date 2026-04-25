import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import SalesKPICards from '@/components/sales/SalesKPICards';
import SalesFilters from '@/components/sales/SalesFilters';
import SalesOrderRow from '@/components/sales/SalesOrderRow';

export default function Sales() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const queryClient = useQueryClient();

  const [syncProgress, setSyncProgress] = useState('');

  const handleSync = async () => {
    setSyncing(true);
    setSyncProgress('Starting…');
    let nextPageUrl = '';
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalUnchanged = 0;
    let totalSkipped = 0;
    let totalProcessed = 0;
    let batchNum = 0;

    try {
      let hasMore = true;
      let maxPages = 1; // Start conservative, ramp up if orders are mostly unchanged
      while (hasMore) {
        batchNum++;
        const params = { financial_status: 'paid', fulfillment_status: 'unfulfilled', max_pages: maxPages };
        if (nextPageUrl) params.next_page_url = nextPageUrl;
        setSyncProgress(`Batch ${batchNum}: fetching orders…`);
        const res = await base44.functions.invoke('bulkSyncOrders', params);
        const d = res.data;
        totalCreated += d.created || 0;
        totalUpdated += d.updated || 0;
        totalUnchanged += d.unchanged || 0;
        totalSkipped += d.skipped || 0;
        totalProcessed += d.chunk_size || 0;
        nextPageUrl = d.next_page_url || '';
        hasMore = d.has_more;

        // Adaptive: if most orders were unchanged (fast), ramp up pages for next batch
        const changedCount = (d.created || 0) + (d.updated || 0) + (d.skipped || 0);
        const unchangedCount = d.unchanged || 0;
        if (unchangedCount > 0 && changedCount <= 5) {
          maxPages = Math.min(maxPages + 1, 5); // ramp up
        } else if (changedCount > 15) {
          maxPages = 1; // slow down — lots of heavy processing
        }

        setSyncProgress(`${totalProcessed} orders processed (${totalCreated} new, ${totalUpdated} updated, ${totalUnchanged} unchanged)${hasMore ? ' — more…' : ''}`);
      }
      const parts = [`${totalCreated} new`, `${totalUpdated} updated`, `${totalUnchanged} unchanged`];
      if (totalSkipped) parts.push(`${totalSkipped} skipped`);
      toast.success(`Synced ${totalProcessed} orders (${parts.join(', ')})`);
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
    } catch (err) {
      toast.error('Sync failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSyncing(false);
      setSyncProgress('');
    }
  };

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['sales-orders'],
    queryFn: () => base44.entities.SalesOrder.list('-order_date', 200),
  });

  const filtered = useMemo(() => {
    let list = orders;
    if (statusFilter !== 'all') {
      list = list.filter(o => o.lifecycle_state === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        (o.order_number || '').toLowerCase().includes(q) ||
        (o.customer_name || '').toLowerCase().includes(q) ||
        (o.customer_email || '').toLowerCase().includes(q) ||
        (o.shopify_order_id || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [orders, statusFilter, search]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <ShoppingCart className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Sales Orders</h1>
        <span className="text-sm text-muted-foreground ml-auto mr-3">{orders.length} orders</span>
        {syncing && syncProgress && (
          <span className="text-xs text-muted-foreground">{syncProgress}</span>
        )}
        <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Sync Shopify'}
        </Button>
      </div>

      <SalesKPICards orders={orders} />

      <SalesFilters
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
      />

      <div className="bg-card rounded-xl border overflow-hidden">
        {/* Table header */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b text-xs font-medium text-muted-foreground bg-muted/40">
          <span className="w-4" />
          <span className="w-28 shrink-0">Order #</span>
          <span className="w-40 shrink-0">Customer</span>
          <span className="w-36 shrink-0">Date & Time</span>
          <span className="w-auto">Status</span>
          <span className="w-24 text-right shrink-0 ml-auto">Amount</span>
          <span className="hidden xl:block flex-1 ml-3">Items</span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No orders found
          </div>
        ) : (
          filtered.map(order => (
            <SalesOrderRow key={order.id} order={order} />
          ))
        )}
      </div>
    </div>
  );
}