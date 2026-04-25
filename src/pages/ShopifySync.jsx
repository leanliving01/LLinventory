import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Database, Search, Calendar } from 'lucide-react';
import ShopifyOrdersTable from '@/components/shopify/ShopifyOrdersTable';
import SyncStatusBanner from '@/components/shopify/SyncStatusBanner';
import ReconPanel from '@/components/shopify/ReconPanel';

export default function ShopifySync() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortOrder, setSortOrder] = useState('newest');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: orders = [] } = useQuery({
    queryKey: ['shopifyOrders'],
    queryFn: () => base44.entities.ShopifyOrder.list('-created_date', 500),
  });

  const paidUnfulfilledOrders = useMemo(() => {
    return orders.filter(o => o.paid_status === 'paid' && o.fulfilment_status === 'unfulfilled');
  }, [orders]);

  const filteredOrders = useMemo(() => {
    let result = [...paidUnfulfilledOrders];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(o =>
        (o.order_number || '').toLowerCase().includes(q) ||
        (o.customer_name || '').toLowerCase().includes(q)
      );
    }
    if (dateFrom) result = result.filter(o => o.order_date && o.order_date.split('T')[0] >= dateFrom);
    if (dateTo) result = result.filter(o => o.order_date && o.order_date.split('T')[0] <= dateTo);
    result.sort((a, b) => {
      const dateA = new Date(a.order_date || 0);
      const dateB = new Date(b.order_date || 0);
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });
    return result;
  }, [paidUnfulfilledOrders, searchQuery, dateFrom, dateTo, sortOrder]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Database className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Shopify Sync Hub</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Sync orders, products, and customers from Shopify. Run reconciliation to check data integrity.
        </p>
      </div>

      {/* All sync types */}
      <SyncStatusBanner showAll={true} />

      {/* Reconciliation */}
      <ReconPanel />

      {/* Legacy ShopifyOrder table for meal-level breakdown */}
      <div className="bg-card border rounded-xl p-4 space-y-4">
        <h3 className="text-sm font-semibold">Paid & Unfulfilled Orders ({paidUnfulfilledOrders.length})</h3>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9" />
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36" />
            <span className="text-muted-foreground text-sm">to</span>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36" />
          </div>
          <Select value={sortOrder} onValueChange={setSortOrder}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectContent>
          </Select>
          {(dateFrom || dateTo || searchQuery) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(''); setDateTo(''); setSearchQuery(''); }}>Clear</Button>
          )}
        </div>

        <ShopifyOrdersTable orders={filteredOrders} />
      </div>
    </div>
  );
}