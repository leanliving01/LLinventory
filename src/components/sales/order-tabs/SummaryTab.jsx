import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Package } from 'lucide-react';
import { formatDateTimeSAST } from '@/lib/dateUtils';
import { channelLabels, sectionProgress } from '@/lib/salesOrderStatus';
import OrderStatusBadges from '../OrderStatusBadges';
import InfoGrid from '../order-shared/InfoGrid';
import OrderLinesTable from '../order-shared/OrderLinesTable';
import FinancialTotals from '../order-shared/FinancialTotals';
import { money } from '../order-shared/money';

/**
 * One-stop summary dashboard. Uses the full page width: status + key info and
 * customer/address sit side by side as compact blocks; the order lines table
 * spans the full width; the financial overview sits directly underneath.
 */
export default function SummaryTab({
  order,
  lines = [],
  linesLoading = false,
  financialLines = [],
  returnsCount = 0,
  refundLineCount = 0,
}) {
  const tags = (order.tags || '').split('|').map((t) => t.trim()).filter(Boolean);
  const progress = sectionProgress(order);
  const outstanding = (Number(order.total_amount) || 0) - (Number(order.amount_paid) || 0);

  const keyInfo = [
    { label: 'Sales Channel', value: channelLabels[order.order_source] || order.order_source },
    { label: 'Order Reference', value: order.order_number || order.shopify_order_id || '—' },
    order.order_source !== 'shopify'
      ? { label: 'Internal Number', value: order.internal_order_number }
      : null,
    { label: 'Order Date', value: order.order_date ? formatDateTimeSAST(order.order_date) : '—' },
    order.shipped_at ? { label: 'Shipped', value: formatDateTimeSAST(order.shipped_at) } : null,
    order.cancelled_at ? { label: 'Cancelled', value: formatDateTimeSAST(order.cancelled_at) } : null,
  ];

  const shippingAddress = [
    order.customer_address,
    [order.shipping_city, order.shipping_province].filter(Boolean).join(', '),
    [order.shipping_zip, order.shipping_country].filter(Boolean).join(' '),
  ].filter(Boolean).join('\n');

  const customer = [
    { label: 'Customer', value: order.customer_name },
    { label: 'Email', value: order.customer_email },
    { label: 'Phone', value: order.customer_phone },
    { label: 'Shipping Address', value: shippingAddress },
    order.billing_address ? { label: 'Billing Address', value: order.billing_address } : null,
  ];

  return (
    <div className="space-y-4">
      {/* Top: status/key-info + customer/address side by side (uses the width) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <Card className="p-4">
          <p className="text-sm font-semibold mb-3">Status &amp; Key Info</p>
          <OrderStatusBadges order={order} showChannel returnsCount={returnsCount} refundLineCount={refundLineCount} />
          {progress && <p className="text-xs text-muted-foreground mt-2">{progress}</p>}
          <div className="mt-3">
            <InfoGrid items={keyInfo} />
          </div>
          {tags.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <Badge key={t} variant="outline" className="text-[11px]">{t}</Badge>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <p className="text-sm font-semibold mb-3">Customer &amp; Address</p>
          <InfoGrid items={customer} columns={1} />
          {order.notes && (
            <div className="mt-3 border-t pt-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Order Notes</p>
              <p className="text-sm text-slate-700 whitespace-pre-line">{order.notes}</p>
            </div>
          )}
        </Card>
      </div>

      {/* Full-width order lines */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5" /> Order Lines
          <Badge variant="outline" className="text-[10px] py-0 border-emerald-300 text-emerald-700">
            affects stock
          </Badge>
        </p>
        <OrderLinesTable lines={lines} loading={linesLoading} />
      </div>

      {/* Financial overview directly underneath the lines */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <Card className="p-4">
          <p className="text-sm font-semibold mb-3">Financial Summary</p>
          <FinancialTotals order={order} financialLines={financialLines} lines={lines} />
        </Card>
        <Card className="p-4">
          <p className="text-sm font-semibold mb-1">Order Total</p>
          <p className="text-3xl font-bold">{money(order.total_amount)}</p>
          {order.payment_status === 'paid' ? (
            <span className="inline-flex items-center gap-1 mt-2 text-sm font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-2.5 py-0.5">
              ✓ Order paid
            </span>
          ) : outstanding > 0 ? (
            <p className="text-sm text-orange-600 mt-1">{money(outstanding)} outstanding</p>
          ) : (
            <p className="text-sm text-emerald-600 mt-1">Fully paid</p>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            See the Profitability tab for cost &amp; margin breakdown.
          </p>
        </Card>
      </div>
    </div>
  );
}
