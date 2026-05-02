import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronRight, CookingPot, Clock, Scale, User } from 'lucide-react';
import { formatDateSAST } from '@/lib/dateUtils';

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  pending_review: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

const STATUS_LABELS = {
  draft: 'Draft',
  in_progress: 'In Progress',
  pending_review: 'Pending Review',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function CookingRunCard({ run, onClick }) {
  return (
    <button
      onClick={() => onClick(run)}
      className="w-full text-left bg-card border border-border rounded-xl p-4 hover:shadow-md transition-all group"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <CookingPot className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-bold font-mono">{run.run_number || '—'}</span>
              <Badge className={`text-[10px] ${STATUS_STYLES[run.status] || ''}`}>
                {STATUS_LABELS[run.status] || run.status}
              </Badge>
              {run.run_type === 'top_up' && (
                <Badge variant="outline" className="text-[10px]">Top-Up</Badge>
              )}
            </div>
            <p className="text-sm font-medium">{run.bulk_product_name}</p>
            <p className="text-[11px] font-mono text-muted-foreground">{run.bulk_product_sku}</p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors mt-2" />
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          {run.run_date ? formatDateSAST(run.run_date + 'T00:00') : '—'}
        </span>
        <span className="flex items-center gap-1">
          <Scale className="w-3.5 h-3.5" />
          Target: {run.target_output_kg || 0} kg
        </span>
        {run.actual_cooked_output_kg != null && (
          <span className="flex items-center gap-1 font-medium text-foreground">
            Actual: {run.actual_cooked_output_kg} kg
          </span>
        )}
        {run.actual_yield_pct != null && (
          <span className={`font-medium ${run.yield_variance_pct > 0 ? 'text-green-600' : run.yield_variance_pct < -5 ? 'text-red-600' : 'text-amber-600'}`}>
            Yield: {run.actual_yield_pct.toFixed(1)}%
          </span>
        )}
        {run.assigned_staff_name && (
          <span className="flex items-center gap-1">
            <User className="w-3.5 h-3.5" />
            {run.assigned_staff_name}
          </span>
        )}
      </div>
    </button>
  );
}