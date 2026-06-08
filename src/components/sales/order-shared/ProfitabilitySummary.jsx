import React from 'react';
import { TrendingUp } from 'lucide-react';
import { money } from './money';

function Row({ label, value, dim }) {
  return (
    <div className={`flex items-center justify-between ${dim ? 'text-muted-foreground' : ''}`}>
      <span>{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

/** Order profitability summary card from the order_profitability RPC payload. */
export default function ProfitabilitySummary({ profit }) {
  if (!profit) {
    return (
      <p className="text-xs text-muted-foreground rounded-lg border bg-card p-3">
        Profitability not available for this order.
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
      <p className="text-xs font-semibold text-emerald-800 mb-2 flex items-center gap-1.5">
        <TrendingUp className="w-3.5 h-3.5" /> Order Profitability
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
        <Row label="Product revenue" value={money(profit.product_revenue)} />
        <Row label="Discounts" value={`−${money(profit.discounts)}`} dim={!Number(profit.discounts)} />
        <Row label="Shipping charged" value={money(profit.shipping_charged)} dim={!Number(profit.shipping_charged)} />
        <Row label="Voucher / store credit" value={`−${money(profit.voucher_store_credit)}`} dim={!Number(profit.voucher_store_credit)} />
        <Row
          label="Refunds / returns"
          value={`−${money(Number(profit.refunds_financial) + Number(profit.refunds_returns))}`}
          dim={!(Number(profit.refunds_financial) + Number(profit.refunds_returns))}
        />
        <Row label="Product cost (COGS)" value={`−${money(profit.product_cogs)}`} dim={!Number(profit.product_cogs)} />
        <Row label="Added order costs" value={`−${money(profit.added_order_costs)}`} dim={!Number(profit.added_order_costs)} />
      </div>
      <div className="flex items-center justify-between border-t mt-2 pt-2 text-sm font-bold">
        <span>Net profit</span>
        <span className={Number(profit.net_profit) < 0 ? 'text-rose-600' : 'text-emerald-700'}>
          {Number(profit.net_profit) < 0 ? '−' : ''}
          {money(Math.abs(Number(profit.net_profit)))}
        </span>
      </div>
      {(profit.missing_cost_skus?.length > 0 || profit.missing_boms?.length > 0) && (
        <p className="text-[10px] text-amber-700 mt-1.5">
          ⚠ Cost incomplete — missing cost/BOM for:{' '}
          {[...(profit.missing_cost_skus || []), ...(profit.missing_boms || [])].join(', ')}
        </p>
      )}
    </div>
  );
}
