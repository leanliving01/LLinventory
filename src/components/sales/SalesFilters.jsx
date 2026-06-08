import React from 'react';
import { Search, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

export default function SalesFilters({
  search, onSearchChange,
  statusFilter, onStatusChange,
  packFilter, onPackChange,
  channelFilter, onChannelChange,
  paymentFilter, onPaymentChange,
  fulfilmentFilter, onFulfilmentChange,
  quickFilter, onQuickChange,
}) {
  const quickToggle = (value) => {
    if (!onQuickChange) return;
    onQuickChange(quickFilter === value ? 'none' : value);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search order #, customer, email..."
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <Select value={statusFilter} onValueChange={onStatusChange}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="paid_unfulfilled">Awaiting Fulfilment</SelectItem>
            <SelectItem value="fulfilled">Fulfilled</SelectItem>
            <SelectItem value="pending_payment">Pending Payment</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {onChannelChange && (
        <Select value={channelFilter || 'all'} onValueChange={onChannelChange}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Channel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Channels</SelectItem>
            <SelectItem value="shopify">Shopify</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="retail">Retail</SelectItem>
            <SelectItem value="internal">Internal</SelectItem>
            <SelectItem value="wholesale">Wholesale</SelectItem>
          </SelectContent>
        </Select>
      )}

      {onPaymentChange && (
        <Select value={paymentFilter || 'all'} onValueChange={onPaymentChange}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Payment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Payment</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="partially_paid">Partially Paid</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
            <SelectItem value="partially_refunded">Partially Refunded</SelectItem>
          </SelectContent>
        </Select>
      )}

      {onFulfilmentChange && (
        <Select value={fulfilmentFilter || 'all'} onValueChange={onFulfilmentChange}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Fulfilment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Fulfilment</SelectItem>
            <SelectItem value="unfulfilled">Unfulfilled</SelectItem>
            <SelectItem value="partial">Partially Fulfilled</SelectItem>
            <SelectItem value="fulfilled">Fulfilled</SelectItem>
          </SelectContent>
        </Select>
      )}

      {onPackChange && (
        <Select value={packFilter || 'all'} onValueChange={onPackChange}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Pack Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Pack Status</SelectItem>
            <SelectItem value="pending">Not Packed</SelectItem>
            <SelectItem value="picking">Busy Packing</SelectItem>
            <SelectItem value="partly">Part-Packed (1 section)</SelectItem>
            <SelectItem value="packed">Packed</SelectItem>
            <SelectItem value="shipped">Shipped</SelectItem>
          </SelectContent>
        </Select>
      )}

      {onQuickChange && (
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={quickFilter === 'needs_attention' ? 'default' : 'outline'}
            onClick={() => quickToggle('needs_attention')}
          >
            Needs attention
          </Button>
          <Button
            type="button"
            size="sm"
            variant={quickFilter === 'has_returns' ? 'default' : 'outline'}
            onClick={() => quickToggle('has_returns')}
          >
            Has returns
          </Button>
          <Button
            type="button"
            size="sm"
            variant={quickFilter === 'has_resends' ? 'default' : 'outline'}
            onClick={() => quickToggle('has_resends')}
          >
            Has re-sends
          </Button>
        </div>
      )}
    </div>
  );
}
