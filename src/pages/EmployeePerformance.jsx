import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { startOfMonth, endOfMonth } from 'date-fns';
import DateRangeFilter from '@/components/reports/DateRangeFilter';
import { computeDispatchKpis } from '@/lib/dispatchMetrics';
import { computeMemberProductionStats } from '@/lib/productionMetrics';
import EmployeeTable from '@/components/reports/employee/EmployeeTable';
import EmployeeDetailView from '@/components/reports/employee/EmployeeDetailView';

export default function EmployeePerformance() {
  const [selected, setSelected] = useState(null);
  const [dateRange, setDateRange] = useState({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) });

  const { data: members = [] } = useQuery({
    queryKey: ['team-members'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }, 'name', 100),
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ['all-production-tasks-perf'],
    queryFn: () => base44.entities.ProductionTask.filter({ status: 'done' }, '-finished_at', 2000),
  });
  const { data: taskLogs = [] } = useQuery({
    queryKey: ['all-task-logs-perf'],
    queryFn: () => base44.entities.ProductionTaskLog.list('-timestamp', 5000),
  });
  const { data: packedOrders = [] } = useQuery({
    queryKey: ['dispatch-packed-orders'],
    queryFn: () => base44.entities.SalesOrder.filter({ status: 'packed' }, '-packed_at', 3000),
  });

  const filteredTasks = useMemo(() => tasks.filter(t => {
    if (!t.finished_at) return false;
    const d = new Date(t.finished_at);
    return d >= dateRange.from && d <= dateRange.to;
  }), [tasks, dateRange]);

  const filteredOrders = useMemo(() => packedOrders.filter(o => {
    if (!o.packed_at) return false;
    const d = new Date(o.packed_at);
    return d >= dateRange.from && d <= dateRange.to;
  }), [packedOrders, dateRange]);

  const logsByTask = useMemo(() => {
    const map = {};
    taskLogs.forEach(l => {
      if (!map[l.task_id]) map[l.task_id] = [];
      map[l.task_id].push(l);
    });
    return map;
  }, [taskLogs]);

  const dispatchKpi = useMemo(() => computeDispatchKpis(filteredOrders, members), [filteredOrders, members]);
  const packingByMember = useMemo(() => {
    const m = {};
    dispatchKpi.rows.forEach(r => { m[r.member_id] = r; });
    return m;
  }, [dispatchKpi]);

  const rows = useMemo(() => members.map(member => ({
    member,
    production: computeMemberProductionStats(member.id, filteredTasks, logsByTask),
    packing: packingByMember[member.id] || null,
  })), [members, filteredTasks, logsByTask, packingByMember]);

  if (selected) {
    return (
      <EmployeeDetailView
        member={selected}
        production={computeMemberProductionStats(selected.id, filteredTasks, logsByTask)}
        packing={packingByMember[selected.id] || null}
        packingOrders={filteredOrders.filter(o => o.packed_by_member_id === selected.id)}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Employee Performance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Every person's KPIs across all stations — production &amp; dispatch</p>
        </div>
        <DateRangeFilter dateRange={dateRange} onChange={setDateRange} />
      </div>
      <EmployeeTable rows={rows} onSelect={setSelected} />
    </div>
  );
}
