import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Consistent chart wrapper card with spec-compliant styling.
 * All charts should be wrapped in this.
 */
export default function ChartCard({ title, subtitle, children, className, emptyState }) {
  return (
    <div className={cn(
      "bg-card border border-border rounded-lg shadow-sm overflow-hidden",
      className
    )}>
      <div className="px-5 pt-5 pb-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="px-5 pb-5">
        {emptyState || children}
      </div>
    </div>
  );
}