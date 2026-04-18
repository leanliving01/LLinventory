import React from 'react';
import { cn } from '@/lib/utils';

export default function StatCard({ title, value, icon: Icon, trend, trendLabel, variant = 'default' }) {
  const variants = {
    default: 'bg-card border border-border',
    warning: 'bg-amber-50 border border-amber-200',
    danger: 'bg-red-50 border border-red-200',
    success: 'bg-emerald-50 border border-emerald-200',
    info: 'bg-blue-50 border border-blue-200',
  };

  const iconVariants = {
    default: 'bg-muted text-muted-foreground',
    warning: 'bg-amber-100 text-amber-600',
    danger: 'bg-red-100 text-red-600',
    success: 'bg-emerald-100 text-emerald-600',
    info: 'bg-blue-100 text-blue-600',
  };

  return (
    <div className={cn("rounded-xl p-5", variants[variant])}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
          <p className="text-2xl font-bold mt-1.5 text-foreground">{value}</p>
          {trendLabel && (
            <p className={cn("text-xs mt-1", trend === 'up' ? 'text-emerald-600' : 'text-red-500')}>
              {trendLabel}
            </p>
          )}
        </div>
        {Icon && (
          <div className={cn("p-2.5 rounded-lg", iconVariants[variant])}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </div>
  );
}