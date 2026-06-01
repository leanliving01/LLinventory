import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDurationShort } from '@/lib/taskDuration';
import { perfColor } from '@/components/reports/dispatch/PackerPerformanceTable';

const STATION_COLORS = {
  prep: 'bg-blue-100 text-blue-700',
  cook: 'bg-amber-100 text-amber-700',
  portion: 'bg-green-100 text-green-700',
  dispatch: 'bg-purple-100 text-purple-700',
};

const stationsOf = (m) =>
  Array.isArray(m.stations) && m.stations.length > 0 ? m.stations : (m.station ? [m.station] : []);

/**
 * Combined per-employee overview: production (cook/prep/portion) AND dispatch/packing.
 * rows: [{ member, production, packing }]
 */
export default function EmployeeTable({ rows = [], onSelect }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h3 className="text-sm font-semibold">Employee Performance — All Stations</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Production and dispatch combined. Click a person for their full report.</p>
      </div>
      {rows.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">No active team members</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Stations</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Tasks Done</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Avg Task</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Orders Packed</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Line Items</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Pack Perf.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ member, production, packing }) => (
                <tr key={member.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => onSelect(member)}>
                  <td className="px-4 py-3 font-medium">{member.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {stationsOf(member).map(s => (
                        <Badge key={s} className={cn('text-[10px]', STATION_COLORS[s] || 'bg-muted')}>{s}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center font-semibold">{production.tasksCompleted || '—'}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs">{production.tasksCompleted > 0 ? formatDurationShort(production.avgSec) : '—'}</td>
                  <td className="px-4 py-3 text-center font-semibold">{packing?.orders || '—'}</td>
                  <td className="px-4 py-3 text-center">{packing?.items ? packing.items.toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {!packing || packing.orders === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : packing.insufficient ? (
                      <span className="text-[11px] text-muted-foreground italic">low data</span>
                    ) : packing.perfPct == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={cn('font-bold', perfColor(packing.perfPct))}>{packing.perfPct}%</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
