import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

/**
 * Horizontal bar chart showing top 15 most-ordered SKUs.
 */
export default function TopMoversChart({ skuStats }) {
  const top = skuStats
    .slice()
    .sort((a, b) => b.totalDemand - a.totalDemand)
    .slice(0, 15)
    .map(s => ({
      name: s.name.length > 20 ? s.name.slice(0, 20) + '…' : s.name,
      units: s.totalDemand,
    }));

  if (top.length === 0) {
    return null;
  }

  return (
    <div className="bg-card border rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-3">Top 15 Products by Demand</h3>
      <div style={{ height: Math.max(260, top.length * 28) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={top} layout="vertical" margin={{ left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
            <Bar dataKey="units" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}