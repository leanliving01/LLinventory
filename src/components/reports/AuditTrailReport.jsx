import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Download, Printer, Search, User, Clock } from 'lucide-react';
import { format, subDays, isWithinInterval, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';

const ACTION_COLORS = {
  create: 'bg-emerald-100 text-emerald-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  sync: 'bg-purple-100 text-purple-700',
  import: 'bg-amber-100 text-amber-700',
  finalize: 'bg-indigo-100 text-indigo-700',
  export: 'bg-gray-100 text-gray-700',
};

export default function AuditTrailReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);
  const [actionFilter, setActionFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Push the date range into the query so the trail isn't limited to the newest 500
  // rows globally — otherwise older entries inside the selected range are unreachable.
  const { data: auditLogs = [] } = useQuery({
    queryKey: ['report-audit', startOfDay(from).toISOString(), to.toISOString()],
    queryFn: () => base44.entities.AuditLog.filter(
      { created_date: { $gte: startOfDay(from).toISOString(), $lte: to.toISOString() } },
      '-created_date', 5000
    ),
  });

  const filtered = useMemo(() =>
    auditLogs.filter(log => {
      if (!isWithinInterval(new Date(log.created_date), { start: startOfDay(from), end: to })) return false;
      if (actionFilter !== 'all' && log.action !== actionFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        return (log.description || '').toLowerCase().includes(s) ||
          (log.entity_type || '').toLowerCase().includes(s) ||
          (log.created_by || '').toLowerCase().includes(s);
      }
      return true;
    }),
    [auditLogs, from, to, actionFilter, search]
  );

  const formatUserName = (email) => {
    if (!email) return 'System';
    const name = email.split('@')[0].replace(/[._]/g, ' ');
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  const handleExport = () => {
    downloadCSV('audit_trail.csv', filtered.map(l => ({
      date: format(new Date(l.created_date), 'yyyy-MM-dd HH:mm'),
      action: l.action, entity: l.entity_type, description: l.description, user: l.created_by || 'System',
    })));
  };

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} onExportCSV={handleExport} onPrint={() => window.print()} />

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search logs..." className="pl-8 h-8 text-xs" />
        </div>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
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
        <p className="text-xs text-muted-foreground">{filtered.length} entries</p>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            <Clock className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
            {auditLogs.length === 0 ? 'No audit entries yet' : 'No matching entries'}
          </div>
        ) : (
          <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
            {filtered.slice(0, 100).map(log => (
              <div key={log.id} className="px-4 py-3 hover:bg-muted/30">
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
        {filtered.length > 100 && <p className="text-xs text-muted-foreground text-center py-2">Showing 100 of {filtered.length} — export CSV for full data</p>}
      </div>
    </div>
  );
}