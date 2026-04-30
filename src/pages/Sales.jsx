import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import SalesKPICards from '@/components/sales/SalesKPICards';
import SalesFilters from '@/components/sales/SalesFilters';
import SalesOrderRow from '@/components/sales/SalesOrderRow';
import SyncStatusBanner from '@/components/shopify/SyncStatusBanner';

export default function Sales() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('paid_unfulfilled');
  const [packFilter, setPackFilter] = useState('all');
  const queryClient = useQueryClient();

  const { data: orders = [], isLoading, error: queryError } = useQuery({
    queryKey: ['sales-orders'],
    queryFn: () => base44.entities.SalesOrder.list('-order_date', 2000),
    staleTime: 30000,
    retry: 2,
    retryDelay: 3000,
  });

  const filtered = useMemo(() => {
    let list = orders;
    if (statusFilter !== 'all') {
      list = list.filter(o => o.lifecycle_state === statusFilter);
    }
    if (packFilter !== 'all') {
      list = list.filter(o => o.status === packFilter);
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
  }, [orders, statusFilter, packFilter, search]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <ShoppingCart className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Sales Orders</h1>
        <span className="text-sm text-muted-foreground ml-auto">{filtered.length} shown</span>
      </div>

      <SyncStatusBanner />

      <SalesKPICards orders={orders} />

      <SalesFilters
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        packFilter={packFilter}
        onPackChange={setPackFilter}
      />

      <div className="bg-card rounded-xl border overflow-hidden">
        {/* Table header */}
        <div className="hidden md:flex items-center gap-3 px-4 py-2.5 border-b text-xs font-medium text-muted-foreground bg-muted/40">
          <span className="w-4" />
          <span className="w-28 shrink-0">Order #</span>
          <span className="w-40 shrink-0">Customer</span>
          <span className="w-36 shrink-0">Date & Time</span>
          <span className="flex-1 min-w-[180px]">Status</span>
          <span className="w-28 text-right shrink-0">Amount</span>
        </div>

        {queryError ? (
          <div className="text-center py-12 text-destructive text-sm">
            <p className="font-medium">Failed to load orders</p>
            <p className="text-muted-foreground mt-1">{queryError.message || 'Rate limit — please wait a few seconds and refresh'}</p>
          </div>
        ) : isLoading ? (
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