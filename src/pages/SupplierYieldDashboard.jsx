import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function SupplierYieldDashboard() {
  const { data: yieldRecords = [], isLoading } = useQuery({
    queryKey: ['yield-records-for-supplier'],
    queryFn: () => base44.entities.YieldRecord.list('-production_date', 500),
  });

  // Build supplier yield summary from approved yield records
  const supplierData = useMemo(() => {
    const map = {};
    const approvedStatuses = ['approved_record_only', 'approved_update_average'];
    yieldRecords
      .filter(r => approvedStatuses.includes(r.status) && r.supplier_name)
      .forEach(r => {
        const key = `${r.supplier_name}__${r.bulk_product_name}`;
        if (!map[key]) {
          map[key] = {
            supplierName: r.supplier_name,
            productName: r.bulk_product_name,
            bomExpectedYield: r.bom_expected_yield_pct,
            yields: [],
            costs: [],
            lastDate: null,
          };
        }
        map[key].yields.push(r.actual_yield_pct || 0);
        map[key].costs.push(r.actual_cost_per_cooked_kg || 0);
        if (!map[key].lastDate || r.production_date > map[key].lastDate) {
          map[key].lastDate = r.production_date;
          map[key].latestYield = r.actual_yield_pct;
          map[key].latestCost = r.actual_cost_per_cooked_kg;
        }
      });

    return Object.values(map).map(d => {
      const avgYield = d.yields.reduce((s, v) => s + v, 0) / d.yields.length;
      const avgCost = d.costs.reduce((s, v) => s + v, 0) / d.costs.length;
      return {
        ...d,
        avgYield: Math.round(avgYield * 10) / 10,
        avgCost: Math.round(avgCost * 100) / 100,
        runCount: d.yields.length,
        yieldVariance: Math.round((avgYield - (d.bomExpectedYield || 0)) * 10) / 10,
      };
    }).sort((a, b) => b.runCount - a.runCount);
  }, [yieldRecords]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-primary" /> Supplier Yield Performance
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Rolling averages and supplier comparison from approved yield records
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : supplierData.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No approved yield records yet. Complete and review cooking runs to build supplier data.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Supplier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Product</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Runs</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Avg Yield</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">BOM Expected</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Variance</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Avg Cost/kg</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Latest</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Last Run</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {supplierData.map((d, i) => {
                const TrendIcon = d.yieldVariance > 0 ? TrendingUp : d.yieldVariance < -3 ? TrendingDown : Minus;
                const trendColor = d.yieldVariance > 0 ? 'text-green-600' : d.yieldVariance < -3 ? 'text-red-600' : 'text-amber-600';
                return (
                  <tr key={i} className="hover:bg-muted/30">
                    <td className="px-4 py-3 text-sm font-medium">{d.supplierName}</td>
                    <td className="px-4 py-3 text-sm">{d.productName}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">{d.runCount}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums font-medium">{d.avgYield}%</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums text-muted-foreground">{d.bomExpectedYield || '—'}%</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-medium flex items-center justify-end gap-1 ${trendColor}`}>
                        <TrendIcon className="w-3.5 h-3.5" />
                        {d.yieldVariance > 0 ? '+' : ''}{d.yieldVariance}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">R {d.avgCost.toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums font-medium">{d.latestYield?.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{d.lastDate || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}