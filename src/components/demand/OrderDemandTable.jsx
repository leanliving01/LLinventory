import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const familyColors = {
  MWL: 'bg-blue-100 text-blue-700',
  MLM: 'bg-green-100 text-green-700',
  WWL: 'bg-pink-100 text-pink-700',
  WLM: 'bg-orange-100 text-orange-700',
  LOW_CARB: 'bg-amber-100 text-amber-700',
};

export default function OrderDemandTable({ breakdowns }) {
  const [expandedOrder, setExpandedOrder] = useState(null);

  if (!breakdowns || breakdowns.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
        No demand breakdowns to show. Run a preview first.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-bold uppercase tracking-wide">Order → Demand Breakdown</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground w-8"></th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">Order</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">Customer</th>
              <th className="text-center px-2 py-2 text-xs font-semibold text-blue-700">MWL</th>
              <th className="text-center px-2 py-2 text-xs font-semibold text-green-700">MLM</th>
              <th className="text-center px-2 py-2 text-xs font-semibold text-pink-700">WWL</th>
              <th className="text-center px-2 py-2 text-xs font-semibold text-orange-700">WLM</th>
              <th className="text-center px-2 py-2 text-xs font-semibold text-amber-700">LC</th>
              <th className="text-center px-2 py-2 text-xs font-semibold text-purple-700">BYO</th>
              <th className="text-center px-2 py-2 text-xs font-semibold text-muted-foreground">SKU Lines</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {breakdowns.map(b => {
              const isExpanded = expandedOrder === b.order_number;
              return (
                <React.Fragment key={b.order_number}>
                  <tr
                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setExpandedOrder(isExpanded ? null : b.order_number)}
                  >
                    <td className="px-4 py-2.5">
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    </td>
                    <td className="px-4 py-2.5 font-mono font-medium">{b.order_number}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{b.customer_name}</td>
                    <td className="text-center px-2 py-2.5">{b.mwl || '—'}</td>
                    <td className="text-center px-2 py-2.5">{b.mlm || '—'}</td>
                    <td className="text-center px-2 py-2.5">{b.wwl || '—'}</td>
                    <td className="text-center px-2 py-2.5">{b.wlm || '—'}</td>
                    <td className="text-center px-2 py-2.5">{b.lc || '—'}</td>
                    <td className="text-center px-2 py-2.5">{b.byo || '—'}</td>
                    <td className="text-center px-2 py-2.5 font-medium">{b.total_demand_lines}</td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={10} className="px-6 py-3 bg-muted/10">
                        <div className="grid gap-1 max-h-64 overflow-y-auto">
                          <div className="grid grid-cols-3 gap-2 text-xs font-semibold text-muted-foreground uppercase mb-1">
                            <span>Family → Package</span>
                            <span>SKU</span>
                            <span className="text-right">Qty</span>
                          </div>
                          {b.demand_items.map((item, idx) => (
                            <div key={idx} className="grid grid-cols-3 gap-2 text-xs py-0.5">
                              <span>
                                <Badge className={cn("text-[10px] px-1.5 py-0", familyColors[item.family] || 'bg-gray-100 text-gray-700')}>
                                  {item.family}
                                </Badge>
                                <span className="ml-1 text-muted-foreground">{item.package_name}</span>
                              </span>
                              <span className="truncate">{item.sku_name}</span>
                              <span className="text-right font-mono font-medium">{item.quantity}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}