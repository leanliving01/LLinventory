import React, { useEffect, useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import { STATUS_COLORS } from '@/lib/getKpiStatus';

/**
 * KPI Card — spec §2 KPI Card
 * Icon tile (top-left) + label → hero number → delta → status accent bar
 */
export default function StatCard({ title, value, icon: Icon, status = 'neutral', trendLabel, trendDirection }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.neutral;
  const [displayValue, setDisplayValue] = useState(value);
  const hasAnimated = useRef(false);

  // Count-up animation for numeric values
  useEffect(() => {
    if (hasAnimated.current) { setDisplayValue(value); return; }
    hasAnimated.current = true;
    const numValue = typeof value === 'number' ? value : null;
    if (numValue === null || numValue === 0) { setDisplayValue(value); return; }

    let start = 0;
    const duration = 400;
    const startTime = performance.now();
    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      start = Math.round(numValue * eased);
      setDisplayValue(start);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [value]);

  return (
    <div className={cn(
      "relative bg-card rounded-lg border border-border overflow-hidden card-lift",
      "shadow-sm"
    )}>
      {/* Left accent bar */}
      <div className={cn("absolute left-0 top-0 bottom-0 w-[3px]", colors.dot)} />

      <div className="p-4 pl-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider leading-none">
              {title}
            </p>
            <p className="text-2xl font-bold mt-2 tabular-nums text-foreground leading-none animate-count-up">
              {typeof displayValue === 'number' ? displayValue.toLocaleString() : displayValue}
            </p>
            {trendLabel && (
              <p className={cn(
                "text-xs mt-1.5 font-medium tabular-nums",
                trendDirection === 'good' ? 'text-status-good' :
                trendDirection === 'bad' ? 'text-status-bad' :
                'text-muted-foreground'
              )}>
                {trendLabel}
              </p>
            )}
          </div>

          {/* Icon tile */}
          {Icon && (
            <div className={cn("p-2.5 rounded-md shrink-0", colors.bg)}>
              <Icon className={cn("w-5 h-5", colors.icon)} strokeWidth={1.5} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}