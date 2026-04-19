import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShoppingCart, RefreshCw, Search, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import ShopifyOrdersTable from '@/components/shopify/ShopifyOrdersTable';

export default function ShopifySync() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortOrder, setSortOrder] = useState('newest');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['shopifyOrders'],
    queryFn: () => base44.entities.ShopifyOrder.list('-created_date', 500),
  });

  const handleSync = async () => {
    setSyncing(true);
    const res = await base44.functions.invoke('syncShopifyOrders', {});
    queryClient.invalidateQueries({ queryKey: ['shopifyOrders'] });
    toast.success(`Synced ${res.data.total} orders (${res.data.created} new, ${res.data.updated} updated)`);
    setSyncing(false);
  };

  // Only show paid + unfulfilled orders
  const paidUnfulfilledOrders = useMemo(() => {
    return orders.filter(o => o.paid_status === 'paid' && o.fulfilment_status === 'unfulfilled');
  }, [orders]);

  // Apply filters
  const filteredOrders = useMemo(() => {
    let result = [...paidUnfulfilledOrders];

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(o =>
        (o.order_number || '').toLowerCase().includes(q) ||
        (o.customer_name || '').toLowerCase().includes(q)
      );
    }

    // Date range filter
    if (dateFrom) {
      result = result.filter(o => {
        if (!o.order_date) return false;
        return o.order_date.split('T')[0] >= dateFrom;
      });
    }
    if (dateTo) {
      result = result.filter(o => {
        if (!o.order_date) return false;
        return o.order_date.split('T')[0] <= dateTo;
      });
    }

    // Sort
    result.sort((a, b) => {
      const dateA = new Date(a.order_date || 0);
      const dateB = new Date(b.order_date || 0);
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

    return result;
  }, [paidUnfulfilledOrders, searchQuery, dateFrom, dateTo, sortOrder]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Shopify Orders</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Paid & unfulfilled orders — {filteredOrders.length} of {paidUnfulfilledOrders.length} shown
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={handleSync} disabled={syncing}>
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync Orders'}
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Synced</p>
          <p className="text-xl font-bold mt-1">{orders.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Paid & Unfulfilled</p>
          <p className="text-xl font-bold mt-1 text-amber-600">{paidUnfulfilledOrders.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Meals</p>
          <p className="text-xl font-bold mt-1 text-emerald-600">
            {paidUnfulfilledOrders.reduce((sum, o) => sum + (o.total_meals || 0), 0)}
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Demand Calculated</p>
          <p className="text-xl font-bold mt-1">{paidUnfulfilledOrders.filter(o => o.demand_calculated).length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap bg-card border border-border rounded-xl px-4 py-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search order # or customer..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-40"
            placeholder="From"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-40"
            placeholder="To"
          />
        </div>
        <Select value={sortOrder} onValueChange={setSortOrder}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
          </SelectContent>
        </Select>
        {(dateFrom || dateTo || searchQuery) && (
          <Button variant="ghost" size="sm" onClick={() => { setDateFrom(''); setDateTo(''); setSearchQuery(''); }}>
            Clear
          </Button>
        )}
      </div>

      <ShopifyOrdersTable orders={filteredOrders} />
    </div>
  );
}