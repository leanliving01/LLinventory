import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDurationShort } from '@/lib/taskDuration';
import DateRangeFilter from '@/components/reports/DateRangeFilter';
import DispatchTrendChart from './DispatchTrendChart';
import { perfColor } from './PackerPerformanceTable';

export default function PackerDetailView({ row, orders = [], benchmarkTUh, dateRange, onDateRangeChange, onBack }) {
  const cards = [
    { label: 'Performance', value: row.perfPct != null ? `${row.perfPct}%` : '—', cls: perfColor(row.perfPct) },
    { label: 'Orders Packed', value: row.orders },
    { label: 'Line Items', value: row.items.toLocaleString() },
    { label: 'Meals', value: row.meals.toLocaleString() },
    { label: 'Supplements', value: row.supplements.toLocaleString() },
    { label: 'Avg / Order', value: formatDurationShort(row.avgSecPerOrder) },
    { label: 'Items / Active Hr', value: row.itemsPerHour },
    { label: 'Sec / Item', value: row.secPerItem },
  ];
  const sorted = [...orders].sort((a, b) => new Date(b.packed_at) - new Date(a.packed_at));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
          <div>
            <h1 className="text-2xl font-bold">{row.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Dispatch performance · team benchmark {benchmarkTUh} units / active-hr</p>
          </div>
        </div>
        <DateRangeFilter dateRange={dateRange} onChange={onDateRangeChange} />
      </div>

      {row.insufficient && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Fewer than 3 orders in this period — performance % may not be representative.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="bg-card border border-border rounded-xl p-4">
            <p className={cn('text-xl font-bold', c.cls)}>{c.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2"><DispatchTrendChart orders={orders} from={dateRange.from} to={dateRange.to} /></div>
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-3">Meal mix</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Package meals</span><span className="font-semibold">{row.packageMeals.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Build-your-own</span><span className="font-semibold">{row.byoMeals.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Supplements</span><span className="font-semibold">{row.supplements.toLocaleString()}</span></div>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border"><h3 className="text-sm font-semibold">Order history</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Order</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Packed</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Items</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Meals</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Supp.</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map(o => (
                <tr key={o.id}>
                  <td className="px-4 py-3 font-medium">{o.order_number || o.shopify_order_id || o.id}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{o.packed_at ? new Date(o.packed_at).toLocaleString('en-ZA') : '—'}</td>
                  <td className="px-4 py-3 text-center">{Number(o.packed_items) || 0}</td>
                  <td className="px-4 py-3 text-center">{Number(o.packed_meals) || 0}</td>
                  <td className="px-4 py-3 text-center">{Number(o.packed_supplements) || 0}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs">{formatDurationShort(Number(o.packing_active_seconds) || 0)}</td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">No orders in period</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
