import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import TeamStatCards from '@/components/reports/TeamStatCards';
import MemberPerformanceTable from '@/components/reports/MemberPerformanceTable';
import MemberTaskHistory from '@/components/reports/MemberTaskHistory';
import HelpDrawer from '@/components/help/HelpDrawer';

export default function TeamPerformance() {
  const [selectedMember, setSelectedMember] = useState(null);

  const { data: members = [] } = useQuery({
    queryKey: ['team-members'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }, 'name', 100),
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['all-production-tasks-perf'],
    queryFn: () => base44.entities.ProductionTask.filter(
      { status: 'done' },
      '-finished_at',
      500
    ),
  });

  if (selectedMember) {
    return (
      <div className="space-y-4">
        <MemberTaskHistory
          member={selectedMember}
          tasks={tasks}
          onBack={() => setSelectedMember(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Team Performance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track task completion times and individual performance</p>
        </div>
        <HelpDrawer pageKey="team-performance" />
      </div>

      <TeamStatCards members={members} tasks={tasks} />
      <MemberPerformanceTable
        members={members}
        tasks={tasks}
        onSelectMember={setSelectedMember}
      />
    </div>
  );
}