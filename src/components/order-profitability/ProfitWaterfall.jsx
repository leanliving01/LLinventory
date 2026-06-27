import React, { useMemo } from 'react';
import { Layers } from 'lucide-react';
import { formatZAR } from '@/lib/utils';

const GREEN = '#22c55e';
const RED = '#ef4444';
const NEUTRAL = 'hsl(var(--muted-foreground))';

/**
 * Profit waterfall / margin bridge — Revenue stepped down through COGS,
 * discounts, vouchers, refunds and added costs (and up through shipping
 * charged) to Net Profit. Green = adds to profit, red = takes away, grey =
 * totals. The fastest way to see WHERE the margin is made and where it leaks.
 *
 * Rendered as floating horizontal bars on a shared scale so it reads cleanly
 * even when net profit is negative.
 */
export default function ProfitWaterfall({ summary }) {
  const s = summary || {};

  const { steps, minV, maxV } = useMemo(() => {
    const seq = [
      { name: 'Revenue', delta: s.revenue || 0, total: true },
      { name: 'Product COGS', delta: -(s.cogs || 0) },
      { name: 'Discounts', delta: -(s.discounts || 0) },
      { name: 'Vouchers / Credit', delta: -(s.vouchers || 0) },
      { name: 'Shipping Charged', delta: +(s.shipping || 0) },
      { name: 'Refunds', delta: -(s.refunds || 0) },
      { name: 'Added Costs', delta: -(s.addedCosts || 0) },
      { name: 'Net Profit', delta: null, total: true, value: s.netProfit || 0 },
    ];

    let running = 0;
    let lo = 0, hi = 0;
    const out = seq.map((step) => {
      if (step.total && step.name === 'Revenue') {
        running = step.delta;
        const o = { ...step, low: 0, high: step.delta, value: step.delta, fill: NEUTRAL };
        lo = Math.min(lo, 0, step.delta); hi = Math.max(hi, step.delta);
        return o;
      }
      if (step.total) {
        // Net total: bar from 0 to net value.
        const v = step.value;
        const low = Math.min(0, v), high = Math.max(0, v);
        lo = Math.min(lo, low); hi = Math.max(hi, high);
        return { ...step, low, high, value: v, fill: v >= 0 ? GREEN : RED };
      }
      const prev = running;
      const next = running + step.delta;
      running = next;
      const low = Math.min(prev, next), high = Math.max(prev, next);
      lo = Math.min(lo, low); hi = Math.max(hi, high);
      return { ...step, low, high, value: step.delta, fill: step.delta >= 0 ? GREEN : RED };
    });
    return { steps: out, minV: lo, maxV: hi };
  }, [s]);

  const range = Math.max(1, maxV - minV);
  const pct = (v) => ((v - minV) / range) * 100;

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="flex items-start gap-2 px-5 pt-5 pb-3">
        <Layers className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.75} />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Profit Bridge</h3>
          <p className="text-xs text-muted-foreground mt-0.5">From revenue to net profit — where margin is made and where it leaks</p>
        </div>
      </div>
      <div className="px-5 pb-5 space-y-2">
        {steps.map((st) => {
          const left = pct(st.low);
          const width = Math.max(0.6, pct(st.high) - pct(st.low));
          const isTotal = st.total;
          return (
            <div key={st.name} className="flex items-center gap-3">
              <span className={`text-xs w-28 shrink-0 truncate ${isTotal ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                {st.name}
              </span>
              <div className="relative flex-1 h-6">
                {/* zero baseline */}
                <div className="absolute top-0 bottom-0 w-px bg-border" style={{ left: `${pct(0)}%` }} />
                <div className="absolute top-1/2 -translate-y-1/2 h-5 rounded-sm transition-all duration-700"
                  style={{ left: `${left}%`, width: `${width}%`, background: st.fill, opacity: isTotal ? 1 : 0.85 }} />
              </div>
              <span className="text-xs w-24 text-right tabular-nums font-semibold shrink-0"
                style={{ color: st.fill === NEUTRAL ? 'hsl(var(--foreground))' : st.fill }}>
                {st.value > 0 && !isTotal ? '+' : ''}{formatZAR(st.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
