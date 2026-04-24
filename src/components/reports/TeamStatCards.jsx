import React from 'react';
import { Users, Clock, CheckCircle2, TrendingUp } from 'lucide-react';

function formatDuration(ms) {
  if (!ms || ms <= 0) return '0m';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function TeamStatCards({ members, tasks }) {
  const completedTasks = tasks.filter(t => t.status === 'done' && t.started_at && t.finished_at);
  const totalMembers = members.filter(m => m.is_active).length;
  const totalCompleted = completedTasks.length;

  const avgTime = totalCompleted > 0
    ? completedTasks.reduce((sum, t) => sum + (new Date(t.finished_at) - new Date(t.started_at)), 0) / totalCompleted
    : 0;

  // Fastest member
  const memberTimes = {};
  completedTasks.forEach(t => {
    if (!t.assigned_to) return;
    if (!memberTimes[t.assigned_to]) memberTimes[t.assigned_to] = { total: 0, count: 0 };
    memberTimes[t.assigned_to].total += new Date(t.finished_at) - new Date(t.started_at);
    memberTimes[t.assigned_to].count += 1;
  });

  let fastestName = '—';
  let fastestAvg = Infinity;
  Object.entries(memberTimes).forEach(([id, data]) => {
    const avg = data.total / data.count;
    if (avg < fastestAvg && data.count >= 2) {
      fastestAvg = avg;
      const member = members.find(m => m.id === id);
      fastestName = member?.name || '—';
    }
  });

  const stats = [
    { label: 'Active Team Members', value: totalMembers, icon: Users, color: 'text-blue-600 bg-blue-50' },
    { label: 'Tasks Completed', value: totalCompleted, icon: CheckCircle2, color: 'text-green-600 bg-green-50' },
    { label: 'Avg Task Time', value: formatDuration(avgTime), icon: Clock, color: 'text-amber-600 bg-amber-50' },
    { label: 'Fastest Member', value: fastestName, icon: TrendingUp, color: 'text-purple-600 bg-purple-50' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map(s => (
        <div key={s.label} className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.color}`}>
              <s.icon className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl font-bold">{s.value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
        </div>
      ))}
    </div>
  );
}