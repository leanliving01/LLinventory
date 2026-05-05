import React, { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MessageSquare, ChevronDown, ChevronUp, AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Classify a note's content to determine colour coding.
 * Returns: 'wastage' | 'variance' | 'yield_over' | 'yield_under' | 'normal'
 */
function classifyNote(note) {
  const lower = note.toLowerCase();
  if (/waste\s*\d|wastage|waste:/i.test(note)) return 'wastage';
  if (/variance/i.test(note)) return 'variance';
  // Yield: compare actual vs planned when pattern "Yield: X kg (planned Y)"
  const yieldMatch = note.match(/yield:\s*([\d.]+)\s*kg\s*\(planned\s*([\d.]+)/i);
  if (yieldMatch) {
    const actual = parseFloat(yieldMatch[1]);
    const planned = parseFloat(yieldMatch[2]);
    if (actual < planned * 0.95) return 'yield_under';
    if (actual > planned * 1.05) return 'yield_over';
  }
  return 'normal';
}

const CLASS_CONFIG = {
  wastage:     { bg: 'bg-red-50 dark:bg-red-950/40', border: 'border-l-red-500', icon: AlertTriangle, iconClass: 'text-red-500', label: 'Wastage' },
  variance:    { bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-l-amber-500', icon: AlertTriangle, iconClass: 'text-amber-500', label: 'Variance' },
  yield_under: { bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-l-red-400', icon: TrendingDown, iconClass: 'text-red-500', label: 'Under yield' },
  yield_over:  { bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-l-green-500', icon: TrendingUp, iconClass: 'text-green-600', label: 'Over yield' },
  normal:      { bg: '', border: 'border-l-transparent', icon: null, iconClass: '', label: '' },
};

export default function CompletionTaskNotes({ tasks }) {
  const [expanded, setExpanded] = useState(false);

  const tasksWithNotes = useMemo(() => {
    return tasks.filter(t => t.status === 'done' && t.notes && t.notes.trim());
  }, [tasks]);

  // Count flagged notes for the summary badge
  const flagged = useMemo(() => {
    let wastage = 0, variance = 0, yieldIssue = 0;
    tasksWithNotes.forEach(t => {
      const cls = classifyNote(t.notes);
      if (cls === 'wastage') wastage++;
      else if (cls === 'variance') variance++;
      else if (cls === 'yield_under' || cls === 'yield_over') yieldIssue++;
    });
    return { wastage, variance, yieldIssue };
  }, [tasksWithNotes]);

  if (tasksWithNotes.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-5 py-3 hover:bg-muted/20 transition-colors text-left"
      >
        <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />
        <h3 className="text-sm font-bold">Task Notes</h3>

        {/* Summary badges */}
        <div className="flex items-center gap-1.5 ml-2">
          {flagged.wastage > 0 && (
            <Badge className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-0">
              {flagged.wastage} wastage
            </Badge>
          )}
          {flagged.variance > 0 && (
            <Badge className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-0">
              {flagged.variance} variance
            </Badge>
          )}
          {flagged.yieldIssue > 0 && (
            <Badge className="text-[10px] bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400 border-0">
              {flagged.yieldIssue} yield
            </Badge>
          )}
        </div>

        <Badge variant="outline" className="ml-auto text-xs shrink-0">{tasksWithNotes.length} notes</Badge>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        }
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="divide-y divide-border border-t border-border">
          {tasksWithNotes.map(t => {
            const cls = classifyNote(t.notes);
            const cfg = CLASS_CONFIG[cls];
            const Icon = cfg.icon;
            return (
              <div key={t.id} className={cn("px-5 py-3 border-l-4", cfg.border, cfg.bg)}>
                <div className="flex items-center gap-2 mb-1">
                  {Icon && <Icon className={cn("w-3.5 h-3.5 shrink-0", cfg.iconClass)} />}
                  <span className="text-sm font-semibold">{t.meal_name || t.name}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">{t.station}</Badge>
                  {t.product_sku && (
                    <span className="text-[10px] text-muted-foreground font-mono">{t.product_sku}</span>
                  )}
                  {cfg.label && (
                    <Badge className={cn("text-[10px] ml-auto border-0",
                      cls === 'wastage' && 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
                      cls === 'variance' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
                      cls === 'yield_under' && 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
                      cls === 'yield_over' && 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
                    )}>
                      {cfg.label}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{t.notes}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}