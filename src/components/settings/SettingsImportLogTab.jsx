import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { FileText, Clock, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

const statusConfig = {
  running: { icon: Loader2, color: 'bg-blue-100 text-blue-700', spin: true },
  completed: { icon: CheckCircle2, color: 'bg-green-100 text-green-700' },
  completed_with_warnings: { icon: AlertCircle, color: 'bg-amber-100 text-amber-700' },
  failed: { icon: AlertCircle, color: 'bg-red-100 text-red-700' },
};

export default function SettingsImportLogTab() {
  const { data: logs = [] } = useQuery({
    queryKey: ['importLogs'],
    queryFn: () => base44.entities.ImportLog.list('-created_date', 20),
  });

  return (
    <div className="space-y-4">
      {logs.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No imports have been run yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map(log => {
            const sc = statusConfig[log.status] || statusConfig.completed;
            const Icon = sc.icon;
            return (
              <div key={log.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold capitalize">{log.import_type}</span>
                    <Badge className={sc.color + ' text-[10px]'}>
                      <Icon className={`w-3 h-3 mr-1 ${sc.spin ? 'animate-spin' : ''}`} />
                      {log.status.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {log.started_at ? format(new Date(log.started_at), 'dd/MM/yyyy HH:mm') : '—'}
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>Total: <span className="font-medium text-foreground">{log.total_records || 0}</span></span>
                  <span>Created: <span className="font-medium text-green-600">{log.created_count || 0}</span></span>
                  <span>Updated: <span className="font-medium text-blue-600">{log.updated_count || 0}</span></span>
                  {log.skipped_count > 0 && <span>Skipped: <span className="font-medium">{log.skipped_count}</span></span>}
                  {log.error_count > 0 && <span>Errors: <span className="font-medium text-red-600">{log.error_count}</span></span>}
                </div>
                {log.warnings && log.warnings.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-amber-600 cursor-pointer">
                      {log.warnings.length} warning(s)
                    </summary>
                    <ul className="mt-1 text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-y-auto">
                      {log.warnings.map((w, i) => <li key={i}>· {w}</li>)}
                    </ul>
                  </details>
                )}
                {log.errors && log.errors.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-red-500 cursor-pointer">
                      {log.errors.length} error(s)
                    </summary>
                    <ul className="mt-1 text-xs text-red-400 space-y-0.5 max-h-32 overflow-y-auto">
                      {log.errors.map((e, i) => <li key={i}>· {e}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}