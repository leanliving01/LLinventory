import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { startOfMonth, endOfMonth, format, parseISO } from 'date-fns';
import TeamStatCards from '@/components/reports/TeamStatCards';
import MemberPerformanceTable from '@/components/reports/MemberPerformanceTable';
import MemberDetailView from '@/components/reports/MemberDetailView';
import DateRangeFilter from '@/components/reports/DateRangeFilter';
import HelpDrawer from '@/components/help/HelpDrawer';

export default function TeamPerformance() {
  const [selectedMember, setSelectedMember] = useState(null);
  const [dateRange, setDateRange] = useState({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });

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

  // Filter tasks by date range
  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (!t.finished_at) return false;
      const d = new Date(t.finished_at);
      return d >= dateRange.from && d <= dateRange.to;
    });
  }, [tasks, dateRange]);

  // Build logs lookup by task_id
  const logsByTask = useMemo(() => {
    const map = {};
    taskLogs.forEach(l => {
      if (!map[l.task_id]) map[l.task_id] = [];
      map[l.task_id].push(l);
    });
    return map;
  }, [taskLogs]);

  if (selectedMember) {
    return (
      <MemberDetailView
        member={selectedMember}
        tasks={filteredTasks}
        allTasks={tasks}
        logsByTask={logsByTask}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onBack={() => setSelectedMember(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Team Performance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track task completion times and individual performance</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeFilter dateRange={dateRange} onChange={setDateRange} />
          <HelpDrawer pageKey="team-performance" />
        </div>
      </div>

      <TeamStatCards members={members} tasks={filteredTasks} logsByTask={logsByTask} />
      <MemberPerformanceTable
        members={members}
        tasks={filteredTasks}
        logsByTask={logsByTask}
        onSelectMember={setSelectedMember}
      />
    </div>
  );
}