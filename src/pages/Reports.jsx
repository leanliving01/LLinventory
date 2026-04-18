import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { FileText, Clock } from 'lucide-react';
import { format } from 'date-fns';

export default function Reports() {
  const { data: auditLogs = [] } = useQuery({
    queryKey: ['auditLogs'],
    queryFn: () => base44.entities.AuditLog.list('-created_date', 50),
  });

  const { data: productionRuns = [] } = useQuery({
    queryKey: ['productionRuns'],
    queryFn: () => base44.entities.ProductionRun.list('-created_date', 20),
  });

  const actionColors = {
    create: 'bg-emerald-100 text-emerald-700',
    update: 'bg-blue-100 text-blue-700',
    delete: 'bg-red-100 text-red-700',
    sync: 'bg-purple-100 text-purple-700',
    import: 'bg-amber-100 text-amber-700',
    finalize: 'bg-indigo-100 text-indigo-700',
    export: 'bg-gray-100 text-gray-700',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Reports & Audit</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Production run history and audit trail</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Production Runs */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h3 className="text-sm font-semibold">Production Run History</h3>
          </div>
          {productionRuns.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              <FileText className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
              No production runs yet
            </div>
          ) : (
            <div className="divide-y divide-border">
              {productionRuns.map(run => (
                <div key={run.id} className="px-6 py-3 flex items-center justify-between hover:bg-muted/30">
                  <div>
                    <p className="text-sm font-medium">{format(new Date(run.run_date), 'dd MMM yyyy')}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {run.total_units_to_produce || 0} units • {run.total_skus_below_par || 0} SKUs below par
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    run.status === 'finalized' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {run.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Audit Log */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h3 className="text-sm font-semibold">Audit Log</h3>
          </div>
          {auditLogs.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              <Clock className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
              No audit entries yet
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
              {auditLogs.map(log => (
                <div key={log.id} className="px-6 py-3 hover:bg-muted/30">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${actionColors[log.action] || 'bg-gray-100 text-gray-700'}`}>
                      {log.action}
                    </span>
                    <span className="text-xs text-muted-foreground">{log.entity_type}</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {format(new Date(log.created_date), 'dd MMM HH:mm')}
                    </span>
                  </div>
                  <p className="text-sm text-foreground">{log.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}