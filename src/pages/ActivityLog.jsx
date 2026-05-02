import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollText, Search, ChevronLeft, ChevronRight, Clock, User, Database, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import ActivityLogRow from '@/components/activity-log/ActivityLogRow';

const ACTION_STYLES = {
  create: 'bg-green-100 text-green-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  sync: 'bg-purple-100 text-purple-700',
  import: 'bg-indigo-100 text-indigo-700',
  finalize: 'bg-amber-100 text-amber-700',
  export: 'bg-teal-100 text-teal-700',
};

const PAGE_SIZE = 25;

export default function ActivityLog() {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');
  const [page, setPage] = useState(0);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => base44.entities.AuditLog.list('-created_date', 500),
  });

  // Unique entity types for filter dropdown
  const entityTypes = useMemo(() => {
    const types = [...new Set(logs.map(l => l.entity_type).filter(Boolean))];
    return types.sort();
  }, [logs]);

  // Unique users
  const users = useMemo(() => {
    const u = [...new Set(logs.map(l => l.created_by).filter(Boolean))];
    return u.sort();
  }, [logs]);

  const [userFilter, setUserFilter] = useState('all');

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (actionFilter !== 'all' && l.action !== actionFilter) return false;
      if (entityFilter !== 'all' && l.entity_type !== entityFilter) return false;
      if (userFilter !== 'all' && l.created_by !== userFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        const matches = (l.description || '').toLowerCase().includes(s) ||
          (l.entity_type || '').toLowerCase().includes(s) ||
          (l.created_by || '').toLowerCase().includes(s) ||
          (l.entity_id || '').toLowerCase().includes(s);
        if (!matches) return false;
      }
      return true;
    });
  }, [logs, actionFilter, entityFilter, userFilter, search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ScrollText className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Activity Log</h1>
            <p className="text-sm text-muted-foreground">{filtered.length} entries</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search logs..."
            className="pl-9"
          />
        </div>
        <Select value={actionFilter} onValueChange={v => { setActionFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Action" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            <SelectItem value="create">Create</SelectItem>
            <SelectItem value="update">Update</SelectItem>
            <SelectItem value="delete">Delete</SelectItem>
            <SelectItem value="sync">Sync</SelectItem>
            <SelectItem value="import">Import</SelectItem>
            <SelectItem value="finalize">Finalize</SelectItem>
            <SelectItem value="export">Export</SelectItem>
          </SelectContent>
        </Select>
        <Select value={entityFilter} onValueChange={v => { setEntityFilter(v); setPage(0); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Entity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Entities</SelectItem>
            {entityTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={userFilter} onValueChange={v => { setUserFilter(v); setPage(0); }}>
          <SelectTrigger className="w-48"><SelectValue placeholder="User" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Users</SelectItem>
            {users.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Log list */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">Loading logs...</div>
        ) : paged.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">No log entries found.</div>
        ) : (
          <div className="divide-y divide-border">
            {paged.map(log => (
              <ActivityLogRow key={log.id} log={log} actionStyles={ACTION_STYLES} />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}