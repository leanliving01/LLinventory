import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ArrowUpDown, ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { formatZAR, formatDate } from '@/lib/utils';
import { marginColor, tierMeta } from '@/lib/profitVisual';

const COLS = [
  { key: 'order_number', label: 'Order', align: 'left' },
  { key: 'order_date', label: 'Date', align: 'left' },
  { key: 'shipping_province', label: 'Province', align: 'left' },
  { key: 'fulfillment_type', label: 'Fulfillment', align: 'left' },
  { key: 'product_revenue', label: 'Revenue', align: 'right' },
  { key: 'product_cogs', label: 'COGS', align: 'right' },
  { key: 'net_profit', label: 'Net Profit', align: 'right' },
  { key: 'net_margin', label: 'Margin', align: 'right' },
];

const LIMIT = 150;

/** Drill-down: every order in the window, sortable + searchable. */
export default function OrdersProfitTable({ orders = [] }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'net_profit', dir: 'desc' });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = orders;
    if (needle) {
      r = r.filter((o) =>
        String(o.order_number || '').toLowerCase().includes(needle) ||
        String(o.shipping_province || '').toLowerCase().includes(needle) ||
        String(o.fulfillment_type || '').toLowerCase().includes(needle));
    }
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    return [...r].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (typeof av === 'number' || typeof bv === 'number') return ((av || 0) - (bv || 0)) * mul;
      return String(av || '').localeCompare(String(bv || '')) * mul;
    });
  }, [orders, q, sort]);

  const shown = rows.slice(0, LIMIT);
  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground">All Orders</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {rows.length} orders{rows.length > LIMIT ? ` · showing top ${LIMIT}` : ''} · click to open
          </p>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order / province…"
            className="h-8 w-56 pl-8 text-xs" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-y border-border bg-muted/40">
              {COLS.map((c) => (
                <th key={c.key}
                  className={`px-3 py-2 font-medium text-muted-foreground whitespace-nowrap cursor-pointer select-none ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                  onClick={() => toggleSort(c.key)}>
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    <ArrowUpDown className={`w-3 h-3 ${sort.key === c.key ? 'text-foreground' : 'opacity-30'}`} />
                  </span>
                </th>
              ))}
              <th className="px-3 py-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={COLS.length + 1} className="px-3 py-8 text-center text-muted-foreground">No orders match.</td></tr>
            ) : shown.map((o) => {
              const col = marginColor(o.net_margin);
              const tier = tierMeta(o.net_margin);
              return (
                <tr key={o.order_id} className="border-b border-border/60 hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">
                    <Link to={`/sales?order=${o.order_id}`} className="hover:underline">
                      {o.order_number || o.order_id}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(o.order_date)}</td>
                  <td className="px-3 py-2 text-foreground whitespace-nowrap">{o.shipping_province || '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{o.fulfillment_type}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatZAR(o.product_revenue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatZAR(o.product_cogs)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: col }}>{formatZAR(o.net_profit)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums"
                      style={{ color: col, background: `${col}1a` }} title={tier.label}>
                      {Math.round(o.net_margin)}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link to={`/sales?order=${o.order_id}`} className="text-muted-foreground hover:text-foreground">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
