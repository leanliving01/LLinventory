import React from 'react';
import { money } from './money';

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

/**
 * Compact "what was charged" financial overview for an order. Computes from the
 * ACTUAL line items + financial lines (the reliably-populated source), falling
 * back to the sales_orders summary columns. Shopify sync historically only set
 * total_amount, so reading the columns alone showed zeros for subtotal/discount/
 * shipping — hence we derive them here so the Summary matches Profitability.
 */
export default function FinancialTotals({ order, financialLines = [], lines = [] }) {
  const sumCat = (cats) =>
    financialLines.filter((l) => cats.includes(l.category)).reduce((s, l) => s + (Number(l.amount) || 0), 0);

  // Subtotal = sum of active product lines (matches order_profitability product_revenue).
  const lineSubtotal = lines
    .filter((l) => l.status === 'active')
    .reduce((s, l) => s + (Number(l.line_total) || 0), 0);
  const subtotal = Number(order.subtotal_price) > 0 ? Number(order.subtotal_price) : lineSubtotal;

  const discounts = sumCat(['discount']) || Number(order.total_discounts) || 0;
  const shipping = sumCat(['shipping']) || Number(order.shipping_cost) || 0;
  const taxFromLines = financialLines.reduce((s, l) => s + (Number(l.tax_amount) || 0), 0);
  const tax = Number(order.total_tax) > 0 ? Number(order.total_tax) : taxFromLines;
  const voucher = sumCat(['voucher', 'store_credit']);
  const refunds = sumCat(['refund']);

  const total = Number(order.total_amount) || 0;
  const isPaid = order.payment_status === 'paid';
  const paid = isPaid && !(Number(order.amount_paid) > 0) ? total : Number(order.amount_paid) || 0;
  const outstanding = ['paid', 'refunded', 'voided'].includes(order.payment_status)
    ? Math.max(0, total - paid)
    : total - paid;

  return (
    <div className="space-y-1.5 text-sm">
      <MoneyRow label="Subtotal" value={subtotal} />
      <MoneyRow label="Discounts" value={discounts} sign={-1} dim={!discounts} />
      <MoneyRow label="Shipping" value={shipping} dim={!shipping} />
      <MoneyRow label="VAT / Tax" value={tax} dim={!tax} />
      {voucher !== 0 && <MoneyRow label="Voucher / store credit" value={voucher} sign={-1} />}
      {refunds !== 0 && <MoneyRow label="Refunds" value={refunds} sign={-1} />}
      <div className="border-t pt-1.5 mt-1.5">
        <MoneyRow label="Total" value={total} strong />
      </div>
      <MoneyRow label="Amount paid" value={paid} dim={!paid} />
      {isPaid ? (
        <div className="flex items-center justify-between font-semibold text-emerald-700">
          <span>Status</span>
          <span>✓ Paid</span>
        </div>
      ) : (
        <MoneyRow label="Outstanding" value={outstanding} strong dim={outstanding === 0} />
      )}
    </div>
  );
}
