import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { MessageSquare } from 'lucide-react';

export default function CompletionTaskNotes({ tasks }) {
  const tasksWithNotes = useMemo(() => {
    return tasks.filter(t => t.status === 'done' && t.notes && t.notes.trim());
  }, [tasks]);

  if (tasksWithNotes.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 bg-muted/30 border-b border-border">
        <MessageSquare className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-bold">Task Notes</h3>
        <Badge variant="outline" className="ml-auto text-xs">{tasksWithNotes.length} notes</Badge>
      </div>
      <div className="divide-y divide-border">
        {tasksWithNotes.map(t => (
          <div key={t.id} className="px-5 py-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold">{t.meal_name || t.name}</span>
              <Badge variant="outline" className="text-[10px] capitalize">{t.station}</Badge>
              {t.product_sku && (
                <span className="text-[10px] text-muted-foreground font-mono">{t.product_sku}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{t.notes}</p>
          </div>
        ))}
      </div>
    </div>
  );
}