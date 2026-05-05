import React from 'react';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Clock, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATION_COLORS = {
  prep: 'bg-blue-100 text-blue-700',
  cook: 'bg-amber-100 text-amber-700',
  portion: 'bg-green-100 text-green-700',
};

/**
 * Displays all BOM operations (steps) for the current task's product + BOM layer.
 * Read-only — lets chefs see the full recipe workflow within a single consolidated task.
 *
 * @param {{ operations: object[], currentStation: string }} props
 */
export default function StepsTab({ operations, currentStation }) {
  if (!operations || operations.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-muted-foreground text-sm">No recipe steps defined for this product.</p>
        <p className="text-xs text-muted-foreground mt-1">Steps can be added in Recipes → Edit → Operations.</p>
      </div>
    );
  }

  const sorted = [...operations].sort((a, b) => (a.step_no || 0) - (b.step_no || 0));

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Recipe Steps ({sorted.length})
      </p>

      {sorted.map((op, idx) => {
        const isCurrentStation = op.station === currentStation;

        return (
          <div
            key={op.id || idx}
            className={cn(
              "bg-card border-2 rounded-2xl p-4 transition-all",
              isCurrentStation ? "border-primary/40" : "border-border opacity-70"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                {/* Step number circle */}
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                  isCurrentStation ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}>
                  {op.step_no || idx + 1}
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm">{op.name}</h4>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <Badge className={cn("text-[10px]", STATION_COLORS[op.station] || 'bg-muted text-muted-foreground')}>
                      {op.station}
                    </Badge>
                    {op.cycle_time_min && (
                      <Badge variant="outline" className="text-[10px] gap-0.5">
                        <Clock className="w-2.5 h-2.5" /> {op.cycle_time_min} min
                      </Badge>
                    )}
                    {op.equipment_name && (
                      <Badge variant="outline" className="text-[10px] gap-0.5">
                        <Wrench className="w-2.5 h-2.5" /> {op.equipment_name}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {isCurrentStation && (
                <Badge className="bg-primary/10 text-primary text-[10px] shrink-0">
                  Current
                </Badge>
              )}
            </div>

            {op.notes && (
              <div className="mt-2 ml-11 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed bg-muted/50 rounded-xl p-3">
                {op.notes}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}