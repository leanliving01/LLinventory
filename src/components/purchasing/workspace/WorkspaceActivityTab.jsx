import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { format, parseISO } from 'date-fns';
import { Clock, User } from 'lucide-react';

export default function WorkspaceActivityTab({ poId }) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['audit-logs-po', poId],
    queryFn: () => base44.entities.AuditLog.filter({ entity_id: poId }, '-created_date', 100),
    enabled: !!poId,
  });

  if (isLoading) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading activity...</div>;
  }

  if (logs.length === 0) {
    return <div className="text-center py-12 text-sm text-muted-foreground">No activity recorded yet.</div>;
  }

  return (
    <div className="space-y-2">
      {logs.map(log => (
        <div key={log.id} className="flex gap-3 items-start py-2.5 border-b border-border last:border-0">
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
            <User className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm">{log.description}</p>
            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
              <Clock className="w-3 h-3" />
              {log.created_date
                ? format(parseISO(log.created_date), 'd MMM yyyy HH:mm')
                : '—'}
              {log.created_by && <span>· {log.created_by}</span>}
              <span className="capitalize font-mono bg-muted px-1 rounded">{log.action}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
