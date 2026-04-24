import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { FileText, Clock, Search, User, ChevronDown, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import ProductionTimeBreakdown from '@/components/reports/ProductionTimeBreakdown';

const STATUS_STYLES = {
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

const ACTION_COLORS = {
  create: 'bg-emerald-100 text-emerald-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  sync: 'bg-purple-100 text-purple-700',
  import: 'bg-amber-100 text-amber-700',
  finalize: 'bg-indigo-100 text-indigo-700',
  export: 'bg-gray-100 text-gray-700',
};

export default function Reports() {
  const [actionFilter, setActionFilter] = useState('all');
  const [searchAudit, setSearchAudit] = useState('');
  const [expandedRun, setExpandedRun] = useState(null);

  const { data: auditLogs = [] } = useQuery({
    queryKey: ['auditLogs'],
    queryFn: () => base44.entities.AuditLog.list('-created_date', 100),
  });

  const { data: productionRuns = [] } = useQuery({
    queryKey: ['productionRuns'],
    queryFn: () => base44.entities.ProductionRun.list('-created_date', 20),
  });

  const filteredLogs = auditLogs.filter(log => {
    if (actionFilter !== 'all' && log.action !== actionFilter) return false;
    if (searchAudit) {
      const s = searchAudit.toLowerCase();
      return (log.description || '').toLowerCase().includes(s) ||
        (log.entity_type || '').toLowerCase().includes(s) ||
        (log.created_by || '').toLowerCase().includes(s);
    }
    return true;
  });

  const formatUserName = (email) => {
    if (!email) return 'System';
    const name = email.split('@')[0].replace(/[._]/g, ' ');
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Reports & Audit</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Production run history and full audit trail</p>
      </div>

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
              <div key={run.id}>
                <div className="px-6 py-3 flex items-center justify-between hover:bg-muted/30">
                  <Link to={`/production/run/${run.id}`} className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{run.run_number || format(new Date(run.run_date), 'dd MMM yyyy')}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {run.run_date ? format(new Date(run.run_date), 'dd MMM yyyy') : '—'}
                      {run.started_at ? ` · Started ${format(new Date(run.started_at), 'HH:mm')}` : ''}
                      {' · '}{run.total_units || 0} units · {run.total_lines || 0} meals
                    </p>
                  </Link>
                  <div className="flex items-center gap-2">
                    <Badge className={cn(STATUS_STYLES[run.status] || 'bg-muted text-muted-foreground')}>
                      {run.status?.replace('_', ' ')}
                    </Badge>
                    {run.status === 'completed' && (
                      <button
                        onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                        className="p-1 rounded hover:bg-muted"
                      >
                        {expandedRun === run.id
                          ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      </button>
                    )}
                  </div>
                </div>
                {expandedRun === run.id && (
                  <div className="px-6 pb-4">
                    <ProductionTimeBreakdown runId={run.id} run={run} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Audit Log */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold">Audit Log</h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchAudit}
                onChange={e => setSearchAudit(e.target.value)}
                className="pl-8 h-8 w-48 text-xs"
              />
            </div>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="create">Create</SelectItem>
                <SelectItem value="update">Update</SelectItem>
                <SelectItem value="delete">Delete</SelectItem>
                <SelectItem value="sync">Sync</SelectItem>
                <SelectItem value="finalize">Finalize</SelectItem>
                <SelectItem value="import">Import</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {filteredLogs.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            <Clock className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
            {auditLogs.length === 0 ? 'No audit entries yet' : 'No matching entries'}
          </div>
        ) : (
          <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
            {filteredLogs.map(log => (
              <div key={log.id} className="px-6 py-3 hover:bg-muted/30">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-700')}>
                    {log.action}
                  </span>
                  <span className="text-xs text-muted-foreground font-medium">{log.entity_type}</span>
                  <div className="flex items-center gap-1 ml-auto text-xs text-muted-foreground">
                    <User className="w-3 h-3" />
                    <span>{formatUserName(log.created_by)}</span>
                    <span className="mx-1">·</span>
                    <span>{format(new Date(log.created_date), 'dd MMM HH:mm')}</span>
                  </div>
                </div>
                <p className="text-sm text-foreground">{log.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}