import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Utensils, Flame, ChefHat, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { logTaskEvent } from '@/lib/taskEventLog';
import { checkTaskDependencies } from '@/lib/taskDependencyCheck';
import FloorRunPicker from '@/components/floor/FloorRunPicker';
import FloorStationPills from '@/components/floor/FloorStationPills';
import FloorTaskList from '@/components/floor/FloorTaskList';
import FloorTaskDetail from '@/pages/floor/FloorTaskDetail';
import TeamMemberSelect from '@/components/kitchen/TeamMemberSelect';
import TaskCompletionModal from '@/components/kitchen/TaskCompletionModal';
import DependencyBlockModal from '@/components/kitchen/DependencyBlockModal';

const STATIONS = [
  { id: 'prep', label: 'Prep', icon: Utensils, color: 'bg-blue-500' },
  { id: 'cook', label: 'Cook', icon: Flame, color: 'bg-amber-500' },
  { id: 'portion', label: 'Portion', icon: ChefHat, color: 'bg-green-500' },
];

export default function FloorTasks() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // Accept ?runId=xxx from production run detail page
  const urlRunId = useMemo(() => new URLSearchParams(window.location.search).get('runId'), []);
  const [selectedRunId, setSelectedRunId] = useState(urlRunId || null);
  const [selectedStation, setSelectedStation] = useState(user?.station || 'prep');
  const [activeDetailTaskId, setActiveDetailTaskId] = useState(null);
  const [pendingStart, setPendingStart] = useState(null);
  const [pendingDone, setPendingDone] = useState(null);
  const [blockMessage, setBlockMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  // Active production runs
  const { data: runs = [], isLoading: loadingRuns } = useQuery({
    queryKey: ['floor-active-runs'],
    queryFn: () => base44.entities.ProductionRun.filter({ status: 'in_progress' }, '-run_date', 10),
  });

  // Auto-select if only one run
  useMemo(() => {
    if (runs.length === 1 && !selectedRunId) setSelectedRunId(runs[0].id);
  }, [runs]);

  // Tasks for selected run
  const { data: tasks = [], isLoading: loadingTasks } = useQuery({
    queryKey: ['floor-tasks', selectedRunId],
    queryFn: () => base44.entities.ProductionTask.filter({ run_id: selectedRunId, archived: false }, 'step_no', 500),
    enabled: !!selectedRunId,
    refetchInterval: 10000,
  });

  // Task logs for timers
  const { data: taskLogs = [] } = useQuery({
    queryKey: ['floor-task-logs', selectedRunId],
    queryFn: () => base44.entities.ProductionTaskLog.filter({ run_id: selectedRunId }, 'timestamp', 2000),
    enabled: !!selectedRunId,
    refetchInterval: 15000,
  });

  // Team members
  const { data: allTeamMembers = [] } = useQuery({
    queryKey: ['floor-team-members'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }, 'name', 100),
  });

  // BOM data for component-level dependency checking
  const { data: allBoms = [] } = useQuery({
    queryKey: ['floor-boms'],
    queryFn: () => base44.entities.Bom.filter({ is_active: true }, '-created_date', 500),
  });

  const { data: allBomComponents = [] } = useQuery({
    queryKey: ['floor-bom-components'],
    queryFn: () => base44.entities.BomComponent.list('-created_date', 3000),
  });

  // Map: product_id → portion BOM components (for dependency checking)
  const bomComponentsMap = useMemo(() => {
    const portionBoms = allBoms.filter(b => b.bom_type === 'portion');
    const map = {};
    portionBoms.forEach(bom => {
      map[bom.product_id] = allBomComponents.filter(c => c.bom_id === bom.id);
    });
    return map;
  }, [allBoms, allBomComponents]);

  const selectedRun = runs.find(r => r.id === selectedRunId);

  // Filter tasks by selected station
  const stationTasks = useMemo(() => {
    return tasks.filter(t => t.station === selectedStation);
  }, [tasks, selectedStation]);

  // Progress stats for selected station
  const progress = useMemo(() => {
    const total = stationTasks.length;
    const done = stationTasks.filter(t => t.status === 'done').length;
    const active = stationTasks.filter(t => t.status === 'in_progress').length;
    return { total, done, active, pending: total - done - active - stationTasks.filter(t => t.status === 'paused').length };
  }, [stationTasks]);

  // Dependency check — component-level for portioning
  const checkDependencies = (task) => {
    const comps = bomComponentsMap[task.product_id] || [];
    return checkTaskDependencies(task, tasks, comps, allBoms, selectedRun?.pick_list_confirmed);
  };

  const handleStatusChange = async (taskId, newStatus) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (newStatus === 'in_progress') {
      const depError = checkDependencies(task);
      if (depError) { setBlockMessage(depError); return; }
      const memberStations = (m) => Array.isArray(m.stations) && m.stations.length > 0 ? m.stations : m.station ? [m.station] : [];
      const stationMembers = allTeamMembers.filter(m => memberStations(m).includes(task.station));
      const alreadyAssigned = task.assigned_to || (task.assigned_members && task.assigned_members !== '[]');
      if (!task.started_at && stationMembers.length > 0 && !alreadyAssigned) {
        setPendingStart({ taskId, newStatus, station: task.station, isPortioning: task.station === 'portion' });
        return;
      }
    }

    if (newStatus === 'done') { setPendingDone(task); return; }

    await doStatusChange(taskId, newStatus);

    // If starting a task, drill into detail view
    if (newStatus === 'in_progress') {
      setActiveDetailTaskId(taskId);
    }
  };

  const handleTeamMemberSelected = async (member) => {
    if (!pendingStart) return;
    const { taskId, newStatus } = pendingStart;
    setPendingStart(null);
    await base44.entities.ProductionTask.update(taskId, { assigned_to: member.id, assigned_name: member.name });
    await doStatusChange(taskId, newStatus);
    setActiveDetailTaskId(taskId);
  };

  const handleTeamMultiSelected = async (members, shortageReason) => {
    if (!pendingStart) return;
    const { taskId, newStatus } = pendingStart;
    setPendingStart(null);
    const ids = JSON.stringify(members.map(m => m.id));
    const names = members.map(m => m.name).join(', ');
    const update = {
      assigned_members: ids,
      assigned_members_names: names,
      assigned_to: members[0]?.id,
      assigned_name: names,
    };
    if (shortageReason) update.notes = `Short-staffed: ${shortageReason}`;
    await base44.entities.ProductionTask.update(taskId, update);
    await doStatusChange(taskId, newStatus);
    setActiveDetailTaskId(taskId);
  };

  const handleTaskCompleted = async (taskId, consumption, meta = {}) => {
    setLoading(true);
    const task = tasks.find(t => t.id === taskId);
    if (task) logTaskEvent(task, 'completed');

    const isPortioningTask = consumption.length > 0 && consumption[0].is_portioning;

    if (isPortioningTask) {
      const varianceParts = consumption
        .filter(c => c.actual !== c.picked)
        .map(c => `${c.name}: recipe ${c.picked}, calc ${c.actual} ${c.uom}`);
      let notes = `Plates produced: ${meta.plates_produced || 0}`;
      if (varianceParts.length > 0) notes += ` | Variance: ${varianceParts.join('; ')}`;
      if (meta.variance_note) notes += ` | Note: ${meta.variance_note}`;

      const packagingItems = consumption.filter(c => {
        const sku = (c.sku || '').toUpperCase();
        return sku === 'BPM' || sku === 'SVP' || sku.includes('SLEEVE');
      });
      for (const item of packagingItems) {
        const diff = Math.round((item.actual - item.picked) * 100) / 100;
        if (diff === 0) continue;
        await base44.entities.StockMovement.create({
          product_id: item.input_product_id, product_sku: item.sku, product_name: item.name,
          qty: Math.abs(diff), uom: item.uom,
          reason: diff < 0 ? 'return' : 'production_consume',
          ref_type: 'production_run', ref_id: selectedRunId,
          notes: `[task:${taskId}] Packaging ${diff < 0 ? 'returned' : 'consumed'} (planned ${item.picked}, used ${item.actual})`,
        });
      }
      await base44.entities.ProductionTask.update(taskId, { status: 'done', finished_at: new Date().toISOString(), notes });
    } else {
      const returns = consumption.filter(c => c.actual < c.picked);
      for (const r of returns) {
        const returnQty = Math.round((r.picked - r.actual) * 100) / 100;
        await base44.entities.StockMovement.create({
          product_id: r.input_product_id, product_sku: r.sku, product_name: r.name,
          qty: returnQty, uom: r.uom, reason: 'return',
          ref_type: 'production_run', ref_id: selectedRunId,
          notes: `[task:${taskId}] Returned: picked ${r.picked}, consumed ${r.actual} ${r.uom}`,
        });
      }
      const wastageItems = consumption.filter(c => (c.unusable_wastage || 0) > 0);
      for (const w of wastageItems) {
        await base44.entities.StockMovement.create({
          product_id: w.input_product_id, product_sku: w.sku, product_name: w.name,
          qty: w.unusable_wastage, uom: w.uom, reason: 'wastage_unusable',
          ref_type: 'production_run', ref_id: selectedRunId,
          unit_cost_at_movement: w.cost_per_unit || 0,
          notes: `[task:${taskId}] Unusable waste: ${w.unusable_wastage} ${w.uom}`,
        });
      }
      const summary = consumption.filter(c => c.actual !== c.picked || (c.unusable_wastage || 0) > 0)
        .map(c => `${c.name}: picked ${c.picked}, used ${c.actual} ${c.uom}${c.unusable_wastage > 0 ? `, waste ${c.unusable_wastage}` : ''}`)
        .join('; ');
      await base44.entities.ProductionTask.update(taskId, { status: 'done', finished_at: new Date().toISOString(), notes: summary || undefined });
    }

    setPendingDone(null);
    setActiveDetailTaskId(null);
    setLoading(false);
    queryClient.invalidateQueries({ queryKey: ['floor-tasks', selectedRunId] });
    queryClient.invalidateQueries({ queryKey: ['floor-task-logs', selectedRunId] });
    toast.success('Task completed');
  };

  const doStatusChange = async (taskId, newStatus) => {
    setLoading(true);
    const now = new Date().toISOString();
    const task = tasks.find(t => t.id === taskId);
    const eventMap = { in_progress: task?.status === 'paused' ? 'resumed' : 'started', paused: 'paused', done: 'completed', undo: 'undone' };
    if (task && eventMap[newStatus]) logTaskEvent(task, eventMap[newStatus]);

    if (newStatus === 'undo') {
      const tag = `[task:${taskId}]`;
      const movements = await base44.entities.StockMovement.filter({ ref_type: 'production_run', ref_id: selectedRunId }, '-created_date', 200);
      const taskMovements = movements.filter(m => m.notes && m.notes.includes(tag));
      for (const m of taskMovements) {
        await base44.entities.StockMovement.create({
          product_id: m.product_id, product_sku: m.product_sku, product_name: m.product_name,
          qty: m.qty, uom: m.uom, reason: m.reason === 'return' ? 'production_consume' : 'return',
          ref_type: 'production_run', ref_id: selectedRunId,
          notes: `[undo:${taskId}] Reversed: ${m.notes}`,
        });
      }
      await base44.entities.ProductionTask.update(taskId, { status: 'in_progress', finished_at: null });
    } else if (newStatus === 'in_progress') {
      const update = { status: 'in_progress' };
      if (!task?.started_at) update.started_at = now;
      await base44.entities.ProductionTask.update(taskId, update);
    } else if (newStatus === 'done') {
      await base44.entities.ProductionTask.update(taskId, { status: 'done', finished_at: now });
    } else {
      await base44.entities.ProductionTask.update(taskId, { status: newStatus });
    }
    setLoading(false);
    queryClient.invalidateQueries({ queryKey: ['floor-tasks', selectedRunId] });
    queryClient.invalidateQueries({ queryKey: ['floor-task-logs', selectedRunId] });
  };

  // Step 1: Pick a run
  if (!selectedRunId) {
    return <FloorRunPicker runs={runs} loading={loadingRuns} onSelect={setSelectedRunId} />;
  }

  // If a task detail is open, show full-page drill-down
  const detailTask = activeDetailTaskId ? tasks.find(t => t.id === activeDetailTaskId) : null;
  if (detailTask && (detailTask.status === 'in_progress' || detailTask.status === 'paused')) {
    return (
      <>
        <FloorTaskDetail
          task={detailTask}
          taskLogs={taskLogs.filter(l => l.task_id === detailTask.id)}
          onStatusChange={handleStatusChange}
          onBack={() => setActiveDetailTaskId(null)}
          onDone={(task) => setPendingDone(task)}
          loading={loading}
        />
        {pendingDone && <TaskCompletionModal task={pendingDone} onConfirm={handleTaskCompleted} onCancel={() => setPendingDone(null)} />}
      </>
    );
  }

  const currentStation = STATIONS.find(s => s.id === selectedStation);

  return (
    <div className="space-y-3">
      {/* Run header + back */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setSelectedRunId(null)} className="shrink-0 -ml-2">
          ← Runs
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold">{selectedRun?.run_number || 'Production'}</h1>
        </div>
        <Badge variant="outline" className="text-xs tabular-nums shrink-0">
          {progress.done}/{progress.total} done
        </Badge>
      </div>

      {/* Station filter pills */}
      <FloorStationPills selected={selectedStation} onSelect={setSelectedStation} tasks={tasks} />

      {/* Progress bar */}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", currentStation?.color)}
          style={{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%' }}
        />
      </div>

      {/* Task list — horizontal scroll */}
      {loadingTasks ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading tasks...
        </div>
      ) : (
        <FloorTaskList
          tasks={stationTasks}
          allTasks={tasks}
          taskLogs={taskLogs}
          onStatusChange={handleStatusChange}
          onOpenDetail={setActiveDetailTaskId}
          loading={loading}
          pickListConfirmed={selectedRun?.pick_list_confirmed}
          bomComponentsMap={bomComponentsMap}
          allBoms={allBoms}
          horizontal
        />
      )}

      {/* Modals */}
      {blockMessage && <DependencyBlockModal message={blockMessage} onClose={() => setBlockMessage(null)} />}
      {pendingDone && <TaskCompletionModal task={pendingDone} onConfirm={handleTaskCompleted} onCancel={() => { setPendingDone(null); }} />}
      {pendingStart && (
        <TeamMemberSelect
          members={allTeamMembers.filter(m => {
            const s = Array.isArray(m.stations) && m.stations.length > 0 ? m.stations : m.station ? [m.station] : [];
            return s.includes(pendingStart.station);
          })}
          station={pendingStart.station}
          multiSelect={pendingStart.isPortioning}
          onSelect={handleTeamMemberSelected}
          onSelectMultiple={handleTeamMultiSelected}
          onCancel={() => setPendingStart(null)}
        />
      )}
    </div>
  );
}