import React from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronRight } from 'lucide-react';

function ScoreBadge({ score }) {
  const color = score >= 80 ? 'bg-green-100 text-green-700'
    : score >= 60 ? 'bg-blue-100 text-blue-700'
    : score >= 40 ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700';
  return <Badge className={`text-xs font-bold tabular-nums ${color}`}>{score}</Badge>;
}

function ScoreBar({ score, color }) {
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(score, 2)}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">{score}</span>
    </div>
  );
}

export default function SupplierScoreTable({ items, onSelect, selectedId }) {
  if (items.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl px-4 py-12 text-center text-sm text-muted-foreground">
        No suppliers found
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Rank</th>
              <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Supplier</th>
              <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Overall</th>
              <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Delivery (30%)</th>
              <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Quality (25%)</th>
              <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Price (25%)</th>
              <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Shortage (20%)</th>
              <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">POs</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item, idx) => (
              <tr
                key={item.supplierId}
                onClick={() => onSelect(item.supplierId)}
                className={`cursor-pointer transition-colors ${
                  selectedId === item.supplierId ? 'bg-primary/5' : 'hover:bg-muted/20'
                }`}
              >
                <td className="px-3 py-2.5 text-sm font-medium text-muted-foreground tabular-nums">{idx + 1}</td>
                <td className="px-3 py-2.5 text-sm font-semibold">{item.name}</td>
                <td className="px-3 py-2.5 text-center"><ScoreBadge score={item.overall} /></td>
                <td className="px-3 py-2.5"><ScoreBar score={item.deliveryScore} color="bg-blue-500" /></td>
                <td className="px-3 py-2.5"><ScoreBar score={item.qualityScore} color="bg-green-500" /></td>
                <td className="px-3 py-2.5"><ScoreBar score={item.priceScore} color="bg-purple-500" /></td>
                <td className="px-3 py-2.5"><ScoreBar score={item.shortageScore} color="bg-amber-500" /></td>
                <td className="px-3 py-2.5 text-sm text-right tabular-nums text-muted-foreground">{item.totalPOs}</td>
                <td className="px-3 py-2.5"><ChevronRight className="w-4 h-4 text-muted-foreground" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}