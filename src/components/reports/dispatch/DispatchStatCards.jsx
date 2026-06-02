import React, { useMemo } from 'react';
import { Users, Package, ScanLine, Utensils, Pill, Clock } from 'lucide-react';
import { formatDurationShort } from '@/lib/taskDuration';

export default function DispatchStatCards({ events = [], members = [], kpi }) {
  const stats = useMemo(() => {
    const sum = (k) => events.reduce((s, e) => s + (Number(e[k]) || 0), 0);
    const ordersCount = new Set(events.map(e => e.sales_order_id)).size;
    const totalSec = sum('active_seconds');
    return [
      { label: 'Active Packers', value: members.length, icon: Users, color: 'text-blue-600 bg-blue-50' },
      { label: 'Orders Packed', value: ordersCount, icon: Package, color: 'text-indigo-600 bg-indigo-50' },
      { label: 'Line Items Packed', value: sum('packed_items').toLocaleString(), icon: ScanLine, color: 'text-purple-600 bg-purple-50' },
      { label: 'Meals Packed', value: sum('packed_meals').toLocaleString(), icon: Utensils, color: 'text-green-600 bg-green-50' },
      { label: 'Supplements Packed', value: sum('packed_supplements').toLocaleString(), icon: Pill, color: 'text-amber-600 bg-amber-50' },
      { label: 'Avg Time / Order', value: ordersCount > 0 ? formatDurationShort(totalSec / ordersCount) : '—', icon: Clock, color: 'text-rose-600 bg-rose-50' },
    ];
  }, [events, members, kpi]);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {stats.map(s => (
        <div key={s.label} className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.color}`}>
              <s.icon className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl font-bold">{s.value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
        </div>
      ))}
    </div>
  );
}
