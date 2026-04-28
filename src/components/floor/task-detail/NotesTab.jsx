import React from 'react';
import { BookOpen, ListChecks } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/**
 * "Notes" tab — shows chef notes from the BOM, operation step notes, and task-level notes.
 */
export default function NotesTab({ task, bom, operations }) {
  const hasChefNotes = bom?.chef_notes;
  const hasBomNotes = bom?.notes;
  const hasTaskNotes = task.notes && task.notes !== 'Kitchen Cooking' && task.notes !== 'Kitchen Prep' && task.notes !== 'Portioning';
  const hasOpNotes = (operations || []).some(op => op.notes);
  const hasAny = hasChefNotes || hasBomNotes || hasTaskNotes || hasOpNotes;

  if (!hasAny) {
    return (
      <div className="text-center py-10">
        <p className="text-muted-foreground text-sm">No notes for this task.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Chef instructions */}
      {hasChefNotes && (
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-amber-50 dark:bg-amber-950/30 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-amber-600" />
            <h3 className="font-bold text-sm text-amber-700 dark:text-amber-400">Chef Instructions</h3>
          </div>
          <div className="px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
            {bom.chef_notes}
          </div>
        </div>
      )}

      {/* Recipe notes */}
      {hasBomNotes && (
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-bold text-sm">Recipe Notes</h3>
          </div>
          <div className="px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
            {bom.notes}
          </div>
        </div>
      )}

      {/* Step-by-step operation notes */}
      {hasOpNotes && (
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-bold text-sm">Step Notes</h3>
          </div>
          <div className="divide-y">
            {operations.filter(op => op.notes).map((op, idx) => (
              <div key={op.id} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold shrink-0">
                    {op.step_no || idx + 1}
                  </span>
                  <p className="font-medium text-sm">{op.name}</p>
                  {op.cycle_time_min && (
                    <Badge variant="outline" className="text-[10px] ml-auto">{op.cycle_time_min} min</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground ml-7 leading-relaxed whitespace-pre-wrap">{op.notes}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Task-level notes */}
      {hasTaskNotes && (
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-bold text-sm">Task Notes</h3>
          </div>
          <div className="px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
            {task.notes}
          </div>
        </div>
      )}
    </div>
  );
}