import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, ChefHat, Flame, Utensils, Tablet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import KanbanColumn from '@/components/production/KanbanColumn';
import HelpDrawer from '@/components/help/HelpDrawer';
import TeamMemberSelect from '@/components/kitchen/TeamMemberSelect';

const STATIONS = [
  { id: 'prep', label: 'PREP', icon: Utensils, color: 'bg-blue-500' },
  { id: 'cook', label: 'COOK', icon: Flame, color: 'bg-amber-500' },
  { id: 'portion', label: 'PORTION', icon: ChefHat, color: 'bg-green-500' },
];

export default function Kanban() {
  const runId = window.location.pathname.split('/').filter(Boolean).find((_, i, arr) => arr[i - 1] === 'run');
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [pendingStart, setPendingStart] = useState(null); // { taskId, newStatus, station }

  const { data: run } = useQuery({
    queryKey: ['production-run', runId],
    queryFn: () => base44.entities.ProductionRun.filter({ id: runId }).then(r => r[0]),
    enabled: !!runId,
  });

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['production-tasks', runId],
    queryFn: () => base44.entities.ProductionTask.filter({ run_id: runId }, 'step_no', 500),
    enabled: !!runId,
  });

  // Load team members for all stations
  const { data: allTeamMembers = [] } = useQuery({
    queryKey: ['team-members-all'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }, 'name', 100),
  });

  const columns = useMemo(() => {
    const cols = { prep: [], cook: [], portion: [] };
    tasks.filter(t => !t.archived).forEach(t => {
      const station = t.station || 'prep';
      if (cols[station]) cols[station].push(t);
    });
    return cols;
  }, [tasks]);

  // Dependency check: prep→cook→portion
  const checkDependencies = (task) => {
    const prereqStation = task.station === 'cook' ? 'prep' : task.station === 'portion' ? 'cook' : null;
    if (!prereqStation) return null;
    const prereqTasks = tasks.filter(t =>
      t.station === prereqStation &&
      t.product_id === task.product_id &&
      !t.archived
    );
    if (prereqTasks.length === 0) return null;
    const incomplete = prereqTasks.filter(t => t.status !== 'done');
    if (incomplete.length === 0) return null;
    const stationLabel = prereqStation === 'prep' ? 'Prep' : 'Cook';
    return `${stationLabel} needs to be done for ${task.meal_name || task.name} first before you can start ${task.station === 'cook' ? 'cooking' : 'portioning'}.`;
  };

  const handleStatusChange = async (taskId, newStatus) => {
    const task = tasks.find(t => t.id === taskId);

    if (newStatus === 'in_progress' && task) {
      const depError = checkDependencies(task);
      if (depError) {
        toast.error(depError);
        return;
      }
      // Ask for team member if starting fresh and members exist
      const memberStations = (m) => Array.isArray(m.stations) && m.stations.length > 0 ? m.stations : m.station ? [m.station] : [];
      const stationMembers = allTeamMembers.filter(m => memberStations(m).includes(task.station));
      if (!task.started_at && stationMembers.length > 0 && !task.assigned_to) {
        setPendingStart({ taskId, newStatus, station: task.station });
        return;
      }
    }

    await doStatusChange(taskId, newStatus);
  };

  const handleTeamMemberSelected = async (member) => {
    if (!pendingStart) return;
    const { taskId, newStatus } = pendingStart;
    setPendingStart(null);
    await base44.entities.ProductionTask.update(taskId, {
      assigned_to: member.id,
      assigned_name: member.name,
    });
    await doStatusChange(taskId, newStatus);
  };

  const doStatusChange = async (taskId, newStatus) => {
    const now = new Date().toISOString();
    const task = tasks.find(t => t.id === taskId);

    if (newStatus === 'undo') {
      await base44.entities.ProductionTask.update(taskId, {
        status: 'in_progress',
        finished_at: null,
      });
    } else if (newStatus === 'in_progress') {
      const update = { status: 'in_progress' };
      if (!task?.started_at) update.started_at = now;
      await base44.entities.ProductionTask.update(taskId, update);
    } else if (newStatus === 'done') {
      await base44.entities.ProductionTask.update(taskId, {
        status: 'done',
        finished_at: now,
      });
    } else {
      await base44.entities.ProductionTask.update(taskId, { status: newStatus });
    }
    queryClient.invalidateQueries({ queryKey: ['production-tasks', runId] });
  };

  if (!run) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to={`/production/run/${runId}`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Kitchen Board — {run.run_number}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{tasks.length} tasks across 3 stations</p>
          </div>
        </div>
        <Link to="/kitchen">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Tablet className="w-4 h-4" /> Tablet View
          </Button>
        </Link>
        <HelpDrawer pageKey="kanban" />
      </div>

      {tasks.length === 0 ? (
        <div className="bg-card border border-border rounded-xl px-6 py-12 text-center">
          <p className="text-muted-foreground text-sm mb-3">No tasks have been created for this run yet.</p>
          <p className="text-xs text-muted-foreground">Tasks are auto-created from recipe operations when the run is started. Ensure recipes have operation steps defined.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {STATIONS.map(station => (
            <KanbanColumn
              key={station.id}
              station={station}
              tasks={columns[station.id] || []}
              onStatusChange={handleStatusChange}
              runId={runId}
            />
          ))}
        </div>
      )}

      {/* Team member selection modal */}
      {pendingStart && (
        <TeamMemberSelect
          members={allTeamMembers.filter(m => {
            const s = Array.isArray(m.stations) && m.stations.length > 0 ? m.stations : m.station ? [m.station] : [];
            return s.includes(pendingStart.station);
          })}
          station={pendingStart.station}
          onSelect={handleTeamMemberSelected}
          onCancel={() => setPendingStart(null)}
        />
      )}
    </div>
  );
}