import React from 'react';
import { formatZAR } from '@/lib/utils';
import { marginColor, tierMeta } from '@/lib/profitVisual';
import MealBoxGauge from './MealBoxGauge';

/**
 * Generic profitability breakdown panel — a ranked list of cohorts (pack size,
 * meal package, fulfillment method, …) with a profit bar + margin badge, and an
 * optional row of meal-box gauges for the top performers.
 *
 * Props:
 *   title, subtitle, icon (lucide component)
 *   groups     [{ key, label, profit, margin, revenue, units, orders }]
 *   gaugeCount number of top cohorts to render as meal-box gauges (default 0)
 *   metric     'profit' | 'margin' — what the bar length encodes (default profit)
 *   empty      message when no data
 */
export default function GroupProfitPanel({
  title, subtitle, icon: Icon, groups = [], gaugeCount = 0, metric = 'profit', empty = 'No data in this window yet.',
}) {
  const ranked = [...groups].sort((a, b) =>
    metric === 'margin' ? b.margin - a.margin : b.profit - a.profit);
  const maxProfit = Math.max(1, ...ranked.map((g) => Math.abs(g.profit)));
  const gauges = ranked.filter((g) => g.revenue > 0).slice(0, gaugeCount);

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden h-full flex flex-col">
      <div className="flex items-start gap-2 px-5 pt-5 pb-3">
        {Icon && <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.75} />}
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>

      {ranked.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground py-8">{empty}</div>
      ) : (
        <div className="flex flex-col gap-4 px-5 pb-5">
          {gauges.length > 0 && (
            <div className="flex flex-wrap justify-center gap-4 pb-1">
              {gauges.map((g) => (
                <MealBoxGauge key={g.key} margin={g.margin} size={118}
                  label={g.label} value={formatZAR(g.profit) + ' profit'} />
              ))}
            </div>
          )}

          <div className="space-y-2.5">
            {ranked.map((g) => {
              const w = Math.max(2, (Math.abs(g.profit) / maxProfit) * 100);
              const col = marginColor(g.margin);
              const tier = tierMeta(g.margin);
              return (
                <div key={g.key} className="group">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-medium text-foreground truncate">{g.label}</span>
                    <span className="text-xs font-semibold tabular-nums" style={{ color: col }}>
                      {formatZAR(g.profit)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${w}%`, background: col }} />
                    </div>
                    <span className="text-[11px] font-semibold tabular-nums w-11 text-right"
                      style={{ color: col }} title={tier.label}>
                      {Math.round(g.margin)}%
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                    {formatZAR(g.revenue)} rev · {g.orders} {g.orders === 1 ? 'line' : 'lines'}
                    {g.units ? ` · ${Math.round(g.units)} units` : ''}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
