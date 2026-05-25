import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { RefreshCw, CheckCircle2, AlertCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import SyncHealthIndicator from '@/components/shared/SyncHealthIndicator';

const SOURCE_LABELS = {
  shopify_orders: 'Shopify Orders',
  shopify_products: 'Shopify Products',
  xero_invoices: 'Xero Bills',
  xero_purchase_orders: 'Xero POs',
};

const STATUS_STYLES = {
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  partial: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-600',
};

function StatusIcon({ status }) {
  if (status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />;
  if (status === 'failed') return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
  if (status === 'running') return <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
  return <Clock className="w-3.5 h-3.5 text-amber-500" />;
}

export default function SyncHistory() {
  const [expandedId, setExpandedId] = useState(null);

  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ['sync-logs'],
    queryFn: () => base44.entities.SyncLog.list('-started_at', 50),
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sync History</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Last 50 sync runs across all sources</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Current Status</p>
        <SyncHealthIndicator />
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : logs.length === 0 ? (
        <div className="text-sm text-muted-foreground">No sync logs yet. Logs are created each time a sync runs.</div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Source</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Started</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Duration</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Status</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Fetched</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Created</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Updated</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Errors</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map(log => {
                const durationMs = log.finished_at
                  ? new Date(log.finished_at) - new Date(log.started_at)
                  : null;
                const durationStr = durationMs != null
                  ? durationMs < 1000 ? `${durationMs}ms`
                  : durationMs < 60000 ? `${(durationMs / 1000).toFixed(1)}s`
                  : `${(durationMs / 60000).toFixed(1)}m`
                  : '—';
                const isExpanded = expandedId === log.id;
                return (
                  <>
                    <tr key={log.id} className={log.error_detail ? 'cursor-pointer hover:bg-muted/30' : ''} onClick={() => log.error_detail && setExpandedId(isExpanded ? null : log.id)}>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-medium">{SOURCE_LABELS[log.source] || log.source}</span>
                        <span className="ml-1.5 text-[10px] text-muted-foreground">{log.trigger_type}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {log.started_at ? format(new Date(log.started_at), 'dd/MM/yy HH:mm:ss') : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{durationStr}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <StatusIcon status={log.status} />
                          <Badge className={`text-[10px] px-1.5 ${STATUS_STYLES[log.status] || 'bg-gray-100 text-gray-600'}`}>
                            {log.status}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-right">{log.records_fetched ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-right text-green-700">{log.records_created || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-right text-blue-700">{log.records_updated || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-right text-red-600">{log.errors_count || '—'}</td>
                      <td className="px-2 py-2.5">
                        {log.error_detail && (
                          isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                      </td>
                    </tr>
                    {isExpanded && log.error_detail && (
                      <tr>
                        <td colSpan={9} className="px-4 py-2 bg-red-50 dark:bg-red-950/20">
                          <pre className="text-[11px] text-red-700 whitespace-pre-wrap font-mono">{log.error_detail}</pre>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
