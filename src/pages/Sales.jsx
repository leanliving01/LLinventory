import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import SalesKPICards from '@/components/sales/SalesKPICards';
import SalesFilters from '@/components/sales/SalesFilters';
import SalesOrderRow from '@/components/sales/SalesOrderRow';
import SyncStatusBanner from '@/components/shopify/SyncStatusBanner';
import TablePagination from '@/components/shared/TablePagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function Sales() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('paid_unfulfilled');
  const [packFilter, setPackFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
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
  }, [orders, statusFilter, packFilter, search, sortBy]);

  // Reset page when filters change
  React.useEffect(() => {
    setPage(0);
  }, [statusFilter, packFilter, search, sortBy]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <ShoppingCart className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Sales Orders</h1>
        <span className="text-sm text-muted-foreground ml-auto">{filtered.length} shown</span>
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