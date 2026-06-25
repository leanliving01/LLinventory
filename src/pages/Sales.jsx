import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ShoppingCart, Plus } from 'lucide-react';
import SalesKPICards from '@/components/sales/SalesKPICards';
import SalesFilters from '@/components/sales/SalesFilters';
import SalesOrderRow from '@/components/sales/SalesOrderRow';
import SyncStatusBanner from '@/components/shopify/SyncStatusBanner';
import TablePagination from '@/components/shared/TablePagination';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePersistentState, useScrollRestoration } from '@/lib/usePersistentState';

// Map a few payment_status synonyms to the filter's canonical values.
const PAYMENT_SYNONYMS = {
  paid: ['paid'],
  unpaid: ['unpaid', 'pending'],
  partially_paid: ['partially_paid'],
  refunded: ['refunded'],
  partially_refunded: ['partially_refunded'],
};

export default function Sales() {
  // View/filter state persists for the session so returning from an order detail
  // restores the same filters and page instead of resetting to defaults.
  const [search, setSearch] = usePersistentState('sales:search', '');
  const [statusFilter, setStatusFilter] = usePersistentState('sales:statusFilter', 'paid_unfulfilled');
  const [packFilter, setPackFilter] = usePersistentState('sales:packFilter', 'all');
  const [channelFilter, setChannelFilter] = usePersistentState('sales:channelFilter', 'all');
  const [paymentFilter, setPaymentFilter] = usePersistentState('sales:paymentFilter', 'all');
  const [fulfilmentFilter, setFulfilmentFilter] = usePersistentState('sales:fulfilmentFilter', 'all');
  const [quickFilter, setQuickFilter] = usePersistentState('sales:quickFilter', 'none'); // none | needs_attention | has_returns | has_resends
  const [sortBy, setSortBy] = usePersistentState('sales:sortBy', 'date_desc');
  const [page, setPage] = usePersistentState('sales:page', 0);
  const [pageSize, setPageSize] = usePersistentState('sales:pageSize', 15);
  const queryClient = useQueryClient();

  const { data: orders = [], isLoading, error: queryError } = useQuery({
    queryKey: ['sales-orders'],
    queryFn: () => base44.entities.SalesOrder.list('-order_date', 2000),
    staleTime: 30000,
    retry: 2,
    retryDelay: 3000,
  });

  // Restore scroll position when returning from an order detail.
  useScrollRestoration('sales:scroll', !isLoading);

  // Sets of order ids that have returns / resends — used by the quick toggles.
  // Only fetched lazily when a relevant toggle is active to keep the list fast.
  const needsReturns = quickFilter === 'has_returns';
  const needsResends = quickFilter === 'has_resends';

  const { data: returnRows = [] } = useQuery({
    queryKey: ['sales-orders-with-returns'],
    queryFn: () => base44.entities.ShopifyReturn.list('-created_date', 5000),
    enabled: needsReturns,
    staleTime: 60000,
  });

  const { data: resendRows = [] } = useQuery({
    queryKey: ['sales-orders-with-resends'],
    queryFn: () => base44.entities.SalesResend.list('-created_date', 5000),
    enabled: needsResends,
    staleTime: 60000,
  });

  const returnsOrderIds = useMemo(
    () => new Set(returnRows.map(r => r.sales_order_id).filter(Boolean)),
    [returnRows],
  );
  const resendsOrderIds = useMemo(
    () => new Set(resendRows.map(r => r.sales_order_id).filter(Boolean)),
    [resendRows],
  );

  const filtered = useMemo(() => {
    let list = orders;

    if (statusFilter !== 'all') {
      list = list.filter(o => o.lifecycle_state === statusFilter);
    }

    if (channelFilter !== 'all') {
      list = list.filter(o => (o.order_source || 'shopify') === channelFilter);
    }

    if (paymentFilter !== 'all') {
      const allowed = PAYMENT_SYNONYMS[paymentFilter] || [paymentFilter];
      list = list.filter(o => allowed.includes(o.payment_status));
    }

    if (fulfilmentFilter !== 'all') {
      list = list.filter(o => o.fulfillment_status === fulfilmentFilter);
    }

    if (packFilter === 'partly') {
      // one section packed but the order isn't fully packed yet (split supplements/meals)
      list = list.filter(o => o.status === 'picking' && (o.sup_status === 'done' || o.mea_status === 'done'));
    } else if (packFilter !== 'all') {
      list = list.filter(o => o.status === packFilter);
    }

    if (quickFilter === 'needs_attention') {
      // Unpaid, OR paid-but-not-yet-fulfilled, OR has an unresolved SKU flag.
      list = list.filter(o => {
        const unpaid = ['pending', 'unpaid', 'partially_paid'].includes(o.payment_status);
        const paidUnfulfilled = o.lifecycle_state === 'paid_unfulfilled' && o.fulfillment_status !== 'fulfilled';
        const unresolved = o.has_unmatched_skus === true || o.decomposition_status === 'needs_attention';
        return unpaid || paidUnfulfilled || unresolved;
      });
    } else if (quickFilter === 'has_returns') {
      list = list.filter(o => returnsOrderIds.has(o.id));
    } else if (quickFilter === 'has_resends') {
      list = list.filter(o => resendsOrderIds.has(o.id));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        (o.order_number || '').toLowerCase().includes(q) ||
        (o.internal_order_number || '').toLowerCase().includes(q) ||
        (o.customer_name || '').toLowerCase().includes(q) ||
        (o.customer_email || '').toLowerCase().includes(q) ||
        (o.shopify_order_id || '').toLowerCase().includes(q) ||
        (o.order_source || '').toLowerCase().includes(q)
      );
    }

    const sorted = [...list];
    switch (sortBy) {
      case 'date_asc':
        sorted.sort((a, b) => new Date(a.order_date || 0) - new Date(b.order_date || 0));
        break;
      case 'total_desc':
        sorted.sort((a, b) => (b.total || 0) - (a.total || 0));
        break;
      case 'total_asc':
        sorted.sort((a, b) => (a.total || 0) - (b.total || 0));
        break;
      case 'date_desc':
      default:
        sorted.sort((a, b) => new Date(b.order_date || 0) - new Date(a.order_date || 0));
        break;
    }
    return sorted;
  }, [orders, statusFilter, channelFilter, paymentFilter, fulfilmentFilter, packFilter, quickFilter, search, sortBy, returnsOrderIds, resendsOrderIds]);

  // Reset page when filters change
  React.useEffect(() => {
    setPage(0);
  }, [statusFilter, packFilter, channelFilter, paymentFilter, fulfilmentFilter, quickFilter, search, sortBy]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <ShoppingCart className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Sales Orders</h1>
        <span className="text-sm text-muted-foreground ml-auto">{filtered.length} shown</span>
        <Button asChild size="sm">
          <Link to="/sales/orders/new">
            <Plus className="w-4 h-4 mr-1.5" /> New Sales Order
          </Link>
        </Button>
      </div>

      <SyncStatusBanner />

      <SalesKPICards orders={orders} />

      <div className="flex flex-wrap items-center gap-3">
        <SalesFilters
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          packFilter={packFilter}
          onPackChange={setPackFilter}
          channelFilter={channelFilter}
          onChannelChange={setChannelFilter}
          paymentFilter={paymentFilter}
          onPaymentChange={setPaymentFilter}
          fulfilmentFilter={fulfilmentFilter}
          onFulfilmentChange={setFulfilmentFilter}
          quickFilter={quickFilter}
          onQuickChange={setQuickFilter}
        />
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="date_desc">Date (newest)</SelectItem>
            <SelectItem value="date_asc">Date (oldest)</SelectItem>
            <SelectItem value="total_desc">Total (highest)</SelectItem>
            <SelectItem value="total_asc">Total (lowest)</SelectItem>
          </SelectContent>
        </Select>
      </div>

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
          <>
            {filtered.slice(page * pageSize, (page + 1) * pageSize).map(order => (
              <SalesOrderRow key={order.id} order={order} />
            ))}
            <TablePagination
              page={page}
              pageSize={pageSize}
              totalItems={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={v => { setPageSize(v); setPage(0); }}
            />
          </>
        )}
      </div>
    </div>
  );
}
