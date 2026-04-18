import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShoppingCart, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function ShopifySync() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['shopifyOrders'],
    queryFn: () => base44.entities.ShopifyOrder.list('-created_date', 100),
  });

  const handleSync = async () => {
    setSyncing(true);
    const res = await base44.functions.invoke('syncShopifyOrders', {});
    queryClient.invalidateQueries({ queryKey: ['shopifyOrders'] });
    toast.success(`Synced ${res.data.total} orders (${res.data.created} new, ${res.data.updated} updated)`);
    setSyncing(false);
  };

  const unfulfilled = orders.filter(o => o.fulfilment_status === 'unfulfilled');
  const paid = orders.filter(o => o.paid_status === 'paid');

  const statusColors = {
    paid: 'bg-emerald-100 text-emerald-700',
    unpaid: 'bg-red-100 text-red-700',
    partially_paid: 'bg-amber-100 text-amber-700',
    refunded: 'bg-gray-100 text-gray-700',
  };

  const fulfilmentColors = {
    unfulfilled: 'bg-amber-100 text-amber-700',
    fulfilled: 'bg-emerald-100 text-emerald-700',
    partial: 'bg-blue-100 text-blue-700',
    restocked: 'bg-gray-100 text-gray-700',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Shopify Orders</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Synced orders from Shopify — {unfulfilled.length} unfulfilled, {paid.length} paid
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
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Orders</p>
          <p className="text-xl font-bold mt-1">{orders.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Unfulfilled</p>
          <p className="text-xl font-bold mt-1 text-amber-600">{unfulfilled.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Paid</p>
          <p className="text-xl font-bold mt-1 text-emerald-600">{paid.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Demand Calculated</p>
          <p className="text-xl font-bold mt-1">{orders.filter(o => o.demand_calculated).length}</p>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Order #</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Customer</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Date</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Payment</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Fulfilment</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Meals</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">BYO</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Demand</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <ShoppingCart className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">No orders synced yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Shopify sync will be configured in Settings</p>
                  </td>
                </tr>
              ) : orders.map(order => (
                <tr key={order.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium">{order.order_number}</td>
                  <td className="px-4 py-2.5 text-sm">{order.customer_name || '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">
                    {order.order_date ? format(new Date(order.order_date), 'dd MMM yyyy') : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[order.paid_status] || ''}`}>
                      {order.paid_status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${fulfilmentColors[order.fulfilment_status] || ''}`}>
                      {order.fulfilment_status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm tabular-nums">{order.total_meals || '—'}</td>
                  <td className="px-4 py-2.5 text-center">
                    {order.is_byo ? <Badge className="text-[10px]">BYO</Badge> : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {order.demand_calculated ? (
                      <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Done</span>
                    ) : (
                      <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">Pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}