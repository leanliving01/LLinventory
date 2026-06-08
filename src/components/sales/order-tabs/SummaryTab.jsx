import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateTimeSAST } from '@/lib/dateUtils';
import { channelLabels, sectionProgress } from '@/lib/salesOrderStatus';
import OrderStatusBadges from '../OrderStatusBadges';
import InfoGrid from '../order-shared/InfoGrid';
import { money } from '../order-shared/money';

export default function SummaryTab({ order, returnsCount = 0, refundLineCount = 0 }) {
  const tags = (order.tags || '')
    .split('|')
    .map((t) => t.trim())
    .filter(Boolean);
  const progress = sectionProgress(order);

  const items = [
    { label: 'Sales Channel', value: channelLabels[order.order_source] || order.order_source },
    { label: 'Order Reference', value: order.order_number || order.shopify_order_id || '—' },
    order.order_source !== 'shopify'
      ? { label: 'Internal Number', value: order.internal_order_number }
      : null,
    { label: 'Order Date', value: order.order_date ? formatDateTimeSAST(order.order_date) : '—' },
    { label: 'Customer', value: order.customer_name },
    { label: 'Total', value: money(order.total_amount) },
    { label: 'Amount Paid', value: money(order.amount_paid) },
    { label: 'Outstanding', value: money((Number(order.total_amount) || 0) - (Number(order.amount_paid) || 0)) },
    order.shipped_at ? { label: 'Shipped', value: formatDateTimeSAST(order.shipped_at) } : null,
    order.cancelled_at ? { label: 'Cancelled', value: formatDateTimeSAST(order.cancelled_at) } : null,
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-sm font-semibold mb-3">Status</p>
        <OrderStatusBadges order={order} showChannel returnsCount={returnsCount} refundLineCount={refundLineCount} />
        {progress && <p className="text-xs text-muted-foreground mt-2">{progress}</p>}
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold mb-3">Key Info</p>
        <InfoGrid items={items} />
      </Card>

      {tags.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-semibold mb-3">Tags</p>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <Badge key={t} variant="outline" className="text-[11px]">
                {t}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {order.notes && (
        <Card className="p-4">
          <p className="text-sm font-semibold mb-2">Order Notes</p>
          <p className="text-sm text-slate-700 whitespace-pre-line">{order.notes}</p>
        </Card>
      )}
    </div>
  );
}
