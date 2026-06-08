import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateTimeSAST } from '@/lib/dateUtils';
import { paymentColors, paymentLabels } from '@/lib/salesOrderStatus';
import InfoGrid from '../order-shared/InfoGrid';
import { money } from '../order-shared/money';

export default function PaymentTab({ order }) {
  const outstanding = (Number(order.total_amount) || 0) - (Number(order.amount_paid) || 0);
  const items = [
    { label: 'Payment Method', value: order.payment_method },
    { label: 'Payment Reference', value: order.payment_reference },
    { label: 'Payment Date', value: order.payment_date ? formatDateTimeSAST(order.payment_date) : '—' },
    { label: 'Total', value: money(order.total_amount) },
    { label: 'Amount Paid', value: money(order.amount_paid) },
    { label: 'Outstanding', value: money(outstanding) },
  ];

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold">Payment Status</p>
        {order.payment_status && (
          <Badge
            variant="outline"
            className={`text-xs border ${paymentColors[order.payment_status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}
          >
            {paymentLabels[order.payment_status] || order.payment_status}
          </Badge>
        )}
      </div>
      <InfoGrid items={items} />
    </Card>
  );
}
