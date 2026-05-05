import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { format } from 'date-fns';

const YIELD_THRESHOLD = 80;

function YieldRow({ record, onShowHistory }) {
  const yieldPct = record.actual_yield_pct || 0;
  const rollingAvg = record.rolling_avg_yield_pct;
  const isBelowThreshold = yieldPct < YIELD_THRESHOLD;
  const variancePct = record.yield_variance_pct || 0;

  return (
    <tr
      className="hover:bg-muted/20 transition-colors cursor-pointer border-b border-border last:border-0"
      onClick={() => onShowHistory(record.bulk_product_id, record.bulk_product_name, record.station)}
    >
      <td className="px-4 py-3">
        <p className="text-sm font-semibold">{record.bulk_product_name || record.input_product_name}</p>
        <p className="text-[10px] font-mono text-muted-foreground">{record.bulk_product_sku || record.input_product_sku}</p>
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums text-muted-foreground">
        {(record.required_qty || record.actual_raw_issued_kg || 0).toFixed(2)} {record.uom || 'kg'}
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums font-medium">
        {(record.consumed_qty || record.actual_cooked_output_kg || 0).toFixed(2)} {record.uom || 'kg'}
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums text-muted-foreground">
        {(record.wastage_qty || record.wastage_qty_kg || 0).toFixed(2)}
      </td>
      <td className="px-4 py-3 text-right">
        <span className={`text-sm font-bold tabular-nums ${isBelowThreshold ? 'text-red-600' : yieldPct > 95 ? 'text-green-600' : 'text-foreground'}`}>
          {yieldPct.toFixed(1)}%
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        {rollingAvg != null ? (
          <span className="text-sm tabular-nums text-muted-foreground">{rollingAvg.toFixed(1)}%</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          {variancePct > 2 ? (
            <TrendingUp className="w-3.5 h-3.5 text-green-600" />
          ) : variancePct < -5 ? (
            <TrendingDown className="w-3.5 h-3.5 text-red-600" />
          ) : (
            <Minus className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <span className={`text-sm tabular-nums ${variancePct < -5 ? 'text-red-600' : variancePct > 2 ? 'text-green-600' : 'text-muted-foreground'}`}>
            {variancePct > 0 ? '+' : ''}{variancePct.toFixed(1)}%
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {record.production_date || '—'}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {record.recorded_by_name || '—'}
      </td>
    </tr>
  );
}

export default function YieldStationSection({ title, icon: Icon, records, onShowHistory }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!records || records.length === 0) return null;

  const avgYield = records.length > 0
    ? records.reduce((sum, r) => sum + (r.actual_yield_pct || 0), 0) / records.length
    : 0;
  const belowThresholdCount = records.filter(r => (r.actual_yield_pct || 0) < YIELD_THRESHOLD).length;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          {Icon && <Icon className="w-5 h-5 text-primary" />}
          <h3 className="text-base font-bold">{title}</h3>
          <Badge variant="secondary" className="text-xs">{records.length} items</Badge>
          {belowThresholdCount > 0 && (
            <Badge className="bg-red-100 text-red-600 text-[10px]">
              {belowThresholdCount} below {YIELD_THRESHOLD}%
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">Avg Yield</p>
            <p className={`text-sm font-bold tabular-nums ${avgYield < YIELD_THRESHOLD ? 'text-red-600' : 'text-green-600'}`}>
              {avgYield.toFixed(1)}%
            </p>
          </div>
          {collapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-t border-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Product</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Required</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Actual</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Waste</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Yield %</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Avg (30)</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Variance</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Date</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">By</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 15).map(r => (
                <YieldRow key={r.id} record={r} onShowHistory={onShowHistory} />
              ))}
            </tbody>
          </table>
          {records.length > 15 && (
            <p className="text-center text-xs text-muted-foreground py-3 border-t border-border">
              Showing 15 of {records.length} — click a product to see full history
            </p>
          )}
        </div>
      )}
    </div>
  );
}