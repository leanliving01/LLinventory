import React from 'react';
import { Loader2 } from 'lucide-react';
import { useWorkflowEvents, EVENT_TYPE_LABELS } from '@/lib/salesWorkflowEvents';
import { formatDateTimeSAST } from '@/lib/dateUtils';

// Per-record audit timeline (Phase 9). Reads sales_workflow_events for a
// return or re-send. Used inside the detail-page "Audit History" section.
export default function WorkflowAuditTimeline({ entityType, entityId }) {
  const { data: events = [], isLoading } = useWorkflowEvents(entityType, entityId);

  if (isLoading) {
    return <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  }
  if (events.length === 0) {
    return <p className="text-xs text-muted-foreground">No recorded events yet.</p>;
  }
  return (
    <ol className="space-y-2.5">
      {events.map(e => (
        <li key={e.id} className="flex gap-3 text-sm">
          <div className="flex flex-col items-center">
            <span className="w-2 h-2 rounded-full bg-primary mt-1.5" />
            <span className="flex-1 w-px bg-border" />
          </div>
          <div className="flex-1 pb-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{EVENT_TYPE_LABELS[e.event_type] || e.event_type}</span>
              <span className="text-xs text-muted-foreground">{formatDateTimeSAST(e.created_date)}</span>
              {e.actor && <span className="text-xs text-muted-foreground">· {e.actor}</span>}
            </div>
            {e.description && <p className="text-xs text-muted-foreground mt-0.5">{e.description}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
