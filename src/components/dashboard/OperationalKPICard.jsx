import React from 'react';
import { cn } from '@/lib/utils';
import { STATUS_COLORS } from '@/lib/getKpiStatus';
import { ChevronDown } from 'lucide-react';
import SparkLine from './SparkLine';

/**
 * Clickable KPI card that toggles a detail chart panel.
 * Shows an accent bar, icon, value, trend label, and a chevron indicator.
 */
export default function OperationalKPICard({
  title,
  value,
  icon: Icon,
  status = 'neutral',
  trendLabel,
  trendDirection,
  sparkData,
  isActive,
  onClick,
}) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.neutral;

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative w-full text-left bg-card rounded-lg border overflow-hidden card-lift shadow-sm transition-all",
        isActive
          ? "border-primary ring-1 ring-primary/30"
          : "border-border hover:border-border-strong"
      )}
    >
      {/* Left accent bar */}
      <div className={cn("absolute left-0 top-0 bottom-0 w-[3px]", colors.dot)} />

      <div className="p-4 pl-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider leading-none">
              {title}
            </p>
            <p className="text-2xl font-bold mt-2 tabular-nums text-foreground leading-none">
              {typeof value === 'number' ? value.toLocaleString() : value}
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

          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {Icon && (
              <div className={cn("p-2 rounded-md", colors.bg)}>
                <Icon className={cn("w-4 h-4", colors.icon)} strokeWidth={1.5} />
              </div>
            )}
            {sparkData && sparkData.length >= 2 && (
              <SparkLine data={sparkData} width={56} height={20} />
            )}
            <ChevronDown className={cn(
              "w-3.5 h-3.5 text-muted-foreground transition-transform",
              isActive && "rotate-180 text-primary"
            )} />
          </div>
        </div>
      </div>
    </button>
  );
}