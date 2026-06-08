import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Pencil } from 'lucide-react';
import { formatDateTimeSAST } from '@/lib/dateUtils';

/** Renders edited/imported events with their metadata diff (added/removed/qty). */
export default function OrderEditsTab({ events = [] }) {
  const edits = events.filter((e) => ['edited', 'imported'].includes(e.event_type));

  if (edits.length === 0) {
    return (
      <Card className="p-6 text-center">
        <Pencil className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">No edits recorded for this order.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {edits.map((e) => {
        const meta = e.metadata || {};
        const added = meta.added || [];
        const removed = meta.removed || [];
        const qtyChanges = meta.qty || meta.qty_changes || [];
        return (
          <Card key={e.id} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Pencil className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-sm font-medium capitalize">{e.event_type}</span>
                {e.actor && <Badge variant="outline" className="text-[10px]">{e.actor}</Badge>}
              </div>
              <span className="text-xs text-muted-foreground">
                {e.created_date ? formatDateTimeSAST(e.created_date) : ''}
              </span>
            </div>
            {e.description && <p className="text-sm text-slate-700 mb-2">{e.description}</p>}
            {(added.length > 0 || removed.length > 0 || qtyChanges.length > 0) && (
              <div className="space-y-1 text-xs">
                {added.map((a, i) => (
                  <p key={`a${i}`} className="text-emerald-700">+ {typeof a === 'string' ? a : JSON.stringify(a)}</p>
                ))}
                {removed.map((r, i) => (
                  <p key={`r${i}`} className="text-rose-600">− {typeof r === 'string' ? r : JSON.stringify(r)}</p>
                ))}
                {qtyChanges.map((q, i) => (
                  <p key={`q${i}`} className="text-amber-700">~ {typeof q === 'string' ? q : JSON.stringify(q)}</p>
                ))}
              </div>
            )}
            {meta.total !== undefined && (
              <p className="text-xs text-muted-foreground mt-1">New total: R{Number(meta.total).toFixed(2)}</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
