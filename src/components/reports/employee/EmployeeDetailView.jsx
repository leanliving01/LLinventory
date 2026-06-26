import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatDurationShort, formatDurationLong, formatDurationFromSeconds } from '@/lib/taskDuration';
import DateRangeFilter from '@/components/reports/DateRangeFilter';
import DispatchTrendChart from '@/components/reports/dispatch/DispatchTrendChart';
import { perfColor } from '@/components/reports/dispatch/PackerPerformanceTable';

const STATION_COLORS = {
  prep: 'bg-blue-100 text-blue-700',
  cook: 'bg-amber-100 text-amber-700',
  portion: 'bg-green-100 text-green-700',
  dispatch: 'bg-purple-100 text-purple-700',
};
const stationsOf = (m) =>
  Array.isArray(m.stations) && m.stations.length > 0 ? m.stations : (m.station ? [m.station] : []);

const Tile = ({ label, value, cls }) => (
  <div className="bg-card border border-border rounded-xl p-4">
    <p className={cn('text-lg font-bold', cls)}>{value}</p>
    <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
  </div>
);

export default function EmployeeDetailView({ member, production, packing, packingEvents = [], dateRange, onDateRangeChange, onBack }) {
  const hasProduction = production.tasksCompleted > 0;
  const hasPacking = packing && packing.orders > 0;
  const packEvents = [...packingEvents].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
          <div>
            <h1 className="text-2xl font-bold">{member.name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              {stationsOf(member).map(s => <Badge key={s} className={cn('text-[10px]', STATION_COLORS[s] || 'bg-muted')}>{s}</Badge>)}
              <span className="text-xs text-muted-foreground">{format(dateRange.from, 'dd MMM')} – {format(dateRange.to, 'dd MMM yyyy')}</span>
            </div>
          </div>
        </div>
        <DateRangeFilter dateRange={dateRange} onChange={onDateRangeChange} />
      </div>

      {!hasProduction && !hasPacking && (
        <div className="bg-card border border-border rounded-xl px-6 py-12 text-center text-sm text-muted-foreground">
          No production or packing activity in this period.
        </div>
      )}

      {/* ── Production ── */}
      {hasProduction && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Production · Cook / Prep / Portion</h2>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Tile label="Tasks Completed" value={production.tasksCompleted} />
            <Tile label="Total Working Time" value={formatDurationShort(production.totalSec)} />
            <Tile label="Avg Task Time" value={formatDurationShort(production.avgSec)} />
            <Tile label="Fastest Task" value={formatDurationShort(production.minSec)} cls="text-green-600" />
            <Tile label="Slowest Task" value={formatDurationShort(production.maxSec)} cls="text-red-500" />
          </div>
          {Object.keys(production.byStation).length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {['prep', 'cook', 'portion'].filter(s => production.byStation[s]).map(s => {
                const d = production.byStation[s];
                return (
                  <div key={s} className="bg-card border border-border rounded-xl p-4">
                    <Badge className={cn('text-[10px] mb-2', STATION_COLORS[s])}>{s.toUpperCase()}</Badge>
                    <p className="text-sm font-bold">{d.count} tasks</p>
                    <p className="text-xs text-muted-foreground">Total {formatDurationShort(d.totalSec)} · Avg {formatDurationShort(d.count > 0 ? d.totalSec / d.count : 0)}</p>
                  </div>
                );
              })}
            </div>
          )}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border"><h3 className="text-sm font-semibold">Task History</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Task</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Meal</th>
                    <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Station</th>
                    <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Qty</th>
                    <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Duration</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Completed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {production.tasks.map(t => (
                    <tr key={t.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{t.name}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{t.meal_name || '—'}</td>
                      <td className="px-4 py-3 text-center"><Badge className={cn('text-[10px]', STATION_COLORS[t.station])}>{t.station}</Badge></td>
                      <td className="px-4 py-3 text-center font-semibold">{t.qty || '—'}</td>
                      <td className="px-4 py-3 text-center font-mono text-xs">{formatDurationLong(t.activeDuration)}</td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">{format(new Date(t.finished_at), 'dd MMM HH:mm')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ── Dispatch / Packing ── */}
      {hasPacking && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Dispatch · Packing</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Performance" value={packing.perfPct != null ? `${packing.perfPct}%` : '—'} cls={perfColor(packing.perfPct)} />
            <Tile label="Orders Packed" value={packing.orders} />
            <Tile label="Line Items" value={packing.items.toLocaleString()} />
            <Tile label="Meals" value={packing.meals.toLocaleString()} />
            <Tile label="Supplements" value={packing.supplements.toLocaleString()} />
            <Tile label="Avg / Order" value={formatDurationFromSeconds(packing.avgSecPerOrder)} />
            <Tile label="Items / Active Hr" value={packing.itemsPerHour} />
            <Tile label="Sec / Item" value={packing.secPerItem} />
          </div>
          {packing.insufficient && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Fewer than 3 orders in this period — performance % may not be representative.
            </div>
          )}
          <DispatchTrendChart events={packingEvents} from={dateRange.from} to={dateRange.to} />
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border"><h3 className="text-sm font-semibold">Packing History</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Order</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Section</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Packed</th>
                    <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Items</th>
                    <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Meals</th>
                    <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Supp.</th>
                    <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Time</th>
                    <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Proof</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {packEvents.map(e => (
                    <tr key={e.id}>
                      <td className="px-4 py-3 font-medium">{e.order_number || e.sales_order_id}</td>
                      <td className="px-4 py-3 text-xs capitalize text-muted-foreground">{e.section || 'all'}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{e.timestamp ? new Date(e.timestamp).toLocaleString('en-ZA') : '—'}</td>
                      <td className="px-4 py-3 text-center">{Number(e.packed_items) || 0}</td>
                      <td className="px-4 py-3 text-center">{Number(e.packed_meals) || 0}</td>
                      <td className="px-4 py-3 text-center">{Number(e.packed_supplements) || 0}</td>
                      <td className="px-4 py-3 text-center font-mono text-xs">{formatDurationFromSeconds(e.active_seconds)}</td>
                      <td className="px-4 py-3 text-center">{e.proof_url ? <a href={e.proof_url} target="_blank" rel="noreferrer" className="text-primary underline">view</a> : <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
