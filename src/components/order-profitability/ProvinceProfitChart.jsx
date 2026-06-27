import React, { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts';
import { MapPin } from 'lucide-react';
import { formatZAR } from '@/lib/utils';
import { marginColor } from '@/lib/profitVisual';

/**
 * Province profitability — horizontal bars of net profit per shipping province,
 * coloured by net margin. Answers "where is it most profitable to ship?".
 */
export default function ProvinceProfitChart({ groups = [] }) {
  const data = useMemo(
    () => [...groups]
      .sort((a, b) => b.profit - a.profit)
      .map((g) => ({ name: g.label, profit: Math.round(g.profit), margin: g.margin, orders: g.orders })),
    [groups]
  );

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden h-full">
      <div className="flex items-start gap-2 px-5 pt-5 pb-2">
        <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.75} />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Profit by Province</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Net profit per destination · bar colour = margin health</p>
        </div>
      </div>
      <div className="px-3 pb-4">
        {data.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-sm text-muted-foreground">No orders in this window yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, data.length * 38 + 30)}>
            <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v) => `R${Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} />
              <YAxis type="category" dataKey="name" width={96}
                tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }} />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted))', opacity: 0.35 }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}
                formatter={(v, _n, p) => [`${formatZAR(v)}  ·  ${Math.round(p.payload.margin)}% margin  ·  ${p.payload.orders} orders`, 'Net profit']}
              />
              <Bar dataKey="profit" radius={[0, 4, 4, 0]} barSize={20}>
                {data.map((d, i) => <Cell key={i} fill={marginColor(d.margin)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
