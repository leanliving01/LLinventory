import React from 'react';
import { Card } from '@/components/ui/card';
import { money } from '../order-shared/money';
import FinancialLinesSections from '../order-shared/FinancialLinesSections';
import ProfitabilitySummary from '../order-shared/ProfitabilitySummary';

function MoneyRow({ label, value, sign = 1, strong = false, dim = false }) {
  const n = Number(value) || 0;
  return (
    <div className={`flex items-center justify-between ${strong ? 'font-semibold' : ''} ${dim ? 'text-muted-foreground' : ''}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${sign < 0 ? 'text-rose-600' : ''}`}>
        {sign < 0 ? '−' : ''}
        {money(Math.abs(n))}
      </span>
    </div>
  );
}

export default function FinancialSummaryTab({ order, financialLines = [], profit }) {
  const outstanding = (Number(order.total_amount) || 0) - (Number(order.amount_paid) || 0);
  const voucher = financialLines
    .filter((l) => ['voucher', 'store_credit'].includes(l.category))
    .reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const refunds = financialLines
    .filter((l) => l.category === 'refund')
    .reduce((s, l) => s + (Number(l.amount) || 0), 0);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-sm font-semibold mb-3">Order Financials</p>
        <div className="space-y-1.5 text-sm">
          <MoneyRow label="Subtotal" value={order.subtotal_price} />
          <MoneyRow label="Discounts" value={order.total_discounts} sign={-1} dim={!Number(order.total_discounts)} />
          <MoneyRow label="Shipping" value={order.shipping_cost} dim={!Number(order.shipping_cost)} />
          <MoneyRow label="Tax" value={order.total_tax} dim={!Number(order.total_tax)} />
          {voucher !== 0 && <MoneyRow label="Voucher / store credit" value={voucher} sign={-1} />}
          {refunds !== 0 && <MoneyRow label="Refunds" value={refunds} sign={-1} />}
          <div className="border-t pt-1.5 mt-1.5">
            <MoneyRow label="Total" value={order.total_amount} strong />
          </div>
          <MoneyRow label="Amount paid" value={order.amount_paid} dim={!Number(order.amount_paid)} />
          <MoneyRow label="Outstanding" value={outstanding} strong dim={outstanding === 0} />
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold mb-3">Non-inventory Lines</p>
        <FinancialLinesSections financialLines={financialLines} />
      </Card>

      <ProfitabilitySummary profit={profit} />
    </div>
  );
}
