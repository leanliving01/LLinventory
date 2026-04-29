import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';
import KitchenTopBar from '@/components/kitchen/KitchenTopBar';
import KitchenTaskCard from '@/components/kitchen/KitchenTaskCard';
import TeamMemberSelect from '@/components/kitchen/TeamMemberSelect';
import TaskCompletionModal from '@/components/kitchen/TaskCompletionModal';
import DependencyBlockModal from '@/components/kitchen/DependencyBlockModal';
import TaskDetailView from '@/components/kitchen/TaskDetailView';
import { logTaskEvent } from '@/lib/taskEventLog';
import { checkTaskDependencies } from '@/lib/taskDependencyCheck';

export default function Kitchen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [updating, setUpdating] = useState(false);
  const [pendingStart, setPendingStart] = useState(null); // { taskId, newStatus }
  const [pendingDone, setPendingDone] = useState(null); // task for completion modal
  const [blockMessage, setBlockMessage] = useState(null);
  const [activeTaskId, setActiveTaskId] = useState(null); // task detail view

  const station = user?.station || 'cook';

  // Find today's active run
  const { data: runs = [] } = useQuery({
    queryKey: ['active-runs'],
    queryFn: () => base44.entities.ProductionRun.filter({ status: 'in_progress' }, '-run_date', 10),
  });

  const activeRun = runs[0];

  const { data: tasks = [] } = useQuery({
    queryKey: ['kitchen-tasks', activeRun?.id, station],
    queryFn: () => base44.entities.ProductionTask.filter(
      { run_id: activeRun.id, station, archived: false },
      'step_no',
      100
    ),
    enabled: !!activeRun?.id,
    refetchInterval: 10000,
  });

  // Load ALL tasks for this run (for dependency checks across stations)
  const { data: allRunTasks = [] } = useQuery({
    queryKey: ['all-run-tasks', activeRun?.id],
    queryFn: () => base44.entities.ProductionTask.filter({ run_id: activeRun.id, archived: false }, 'step_no', 500),
    enabled: !!activeRun?.id,
  });

  // Load task event logs for timer accuracy
  const { data: taskLogs = [] } = useQuery({
    queryKey: ['task-logs', activeRun?.id],
    queryFn: () => base44.entities.ProductionTaskLog.filter({ run_id: activeRun.id }, 'timestamp', 2000),
    enabled: !!activeRun?.id,
    refetchInterval: 15000,
  });

  // BOM data for component-level dependency checking
  const { data: allBoms = [] } = useQuery({
    queryKey: ['kitchen-boms'],
    queryFn: () => base44.entities.Bom.filter({ is_active: true }, '-created_date', 500),
  });

  const { data: allBomComponents = [] } = useQuery({
    queryKey: ['kitchen-bom-components'],
    queryFn: () => base44.entities.BomComponent.list('-created_date', 3000),
  });

  // Pre-fetch products so the completion modal opens instantly
  const { data: allProducts = [] } = useQuery({
    queryKey: ['kitchen-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const bomComponentsMap = useMemo(() => {
    const portionBoms = allBoms.filter(b => b.bom_type === 'portion');
    const map = {};
    portionBoms.forEach(bom => {
      map[bom.product_id] = allBomComponents.filter(c => c.bom_id === bom.id);
    });
    return map;
  }, [allBoms, allBomComponents]);

  // Load team members for this station (supports both old `station` and new `stations` array)
  const { data: allStationMembers = [] } = useQuery({
    queryKey: ['team-members-all'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }, 'name', 100),
  });
  const teamMembers = useMemo(() => {
    return allStationMembers.filter(m => {
      const stations = Array.isArray(m.stations) && m.stations.length > 0 ? m.stations : m.station ? [m.station] : [];
      return stations.includes(station);
    });
  }, [allStationMembers, station]);

  // Sort: active first, then pending, then paused, then done
  const sortedTasks = useMemo(() => {
    const order = { in_progress: 0, pending: 1, paused: 2, done: 3 };
    return [...tasks].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [tasks]);

  const doneCount = tasks.filter(t => t.status === 'done').length;

  // Dependency check — component-level for portioning
  const checkDependencies = (task) => {
    const comps = bomComponentsMap[task.product_id] || [];
    return checkTaskDependencies(task, allRunTasks, comps, allBoms, activeRun?.pick_list_confirmed);
  };

  const handleStatusChange = async (taskId, newStatus) => {
    const task = tasks.find(t => t.id === taskId);

    // If starting or resuming, check dependencies first
    if (newStatus === 'in_progress' && task) {
      const depError = checkDependencies(task);
      if (depError) {
        setBlockMessage(depError);
        return;
      }
      // If starting fresh (not resuming) and team members exist, ask for name
      const alreadyAssigned = task.assigned_to || (task.assigned_members && task.assigned_members !== '[]');
      if (!task.started_at && teamMembers.length > 0 && !alreadyAssigned) {
        setPendingStart({ taskId, newStatus, isPortioning: task.station === 'portion' });
        return;
      }
    }

    // Intercept "done" — show completion modal for actual consumption
    if (newStatus === 'done' && task) {
      setPendingDone(task);
      return;
    }

    await doStatusChange(taskId, newStatus);
    // Open detail view when starting a task
    if (newStatus === 'in_progress') setActiveTaskId(taskId);
  };

  const handleTaskCompleted = async (taskId, consumption, meta = {}) => {
    setUpdating(true);
    const task = tasks.find(t => t.id === taskId);
    if (task) logTaskEvent(task, 'completed');

    const isPortioningTask = consumption.length > 0 && consumption[0].is_portioning;

    if (isPortioningTask) {
      // PORTIONING: Manual bulk WIP consumption + auto-calculated packaging
      const varianceParts = consumption
        .filter(c => c.actual !== c.picked)
        .map(c => `${c.name}: available ${c.picked}, used ${c.actual} ${c.uom}`);
      
      let notes = `Plates produced: ${meta.plates_produced || 0}`;
      if (varianceParts.length > 0) notes += ` | Variance: ${varianceParts.join('; ')}`;
      if (meta.variance_note) notes += ` | Note: ${meta.variance_note}`;

      // Handle stock movements for ALL portioning components (bulk WIP + packaging)
      for (const item of consumption) {
        const diff = Math.round((item.actual - item.picked) * 100) / 100;
        if (diff === 0) continue;

        if (item.is_bulk_wip) {
          // Bulk WIP: return excess or record extra consumption
          await base44.entities.StockMovement.create({
            product_id: item.input_product_id, product_sku: item.sku, product_name: item.name,
            qty: Math.abs(diff), uom: item.uom,
            reason: diff < 0 ? 'return' : 'production_consume',
            ref_type: 'production_run', ref_id: activeRun?.id,
            notes: `[task:${taskId}] Bulk ${diff < 0 ? 'excess returned' : 'extra consumed'} (available ${item.picked}, used ${item.actual} ${item.uom})`,
          });
        } else {
          // Packaging
          await base44.entities.StockMovement.create({
            product_id: item.input_product_id, product_sku: item.sku, product_name: item.name,
            qty: Math.abs(diff), uom: item.uom,
            reason: diff < 0 ? 'return' : 'production_consume',
            ref_type: 'production_run', ref_id: activeRun?.id,
            notes: `[task:${taskId}] Packaging ${diff < 0 ? 'returned' : 'consumed'} (planned ${item.picked}, used ${item.actual})`,
          });
        }
      }

      await base44.entities.ProductionTask.update(taskId, {
        status: 'done',
        finished_at: new Date().toISOString(),
        notes,
      });
    } else {
      // PREP/COOK: Manual actual + unusable wastage + stock returns
      const consumptionSummary = consumption
        .filter(c => c.actual !== c.picked || (c.unusable_wastage || 0) > 0)
        .map(c => {
          let s = `${c.name}: picked ${c.picked}, used ${c.actual} ${c.uom}`;
          if (c.unusable_wastage > 0) s += `, waste ${c.unusable_wastage} ${c.uom}`;
          return s;
        })
        .join('; ');

      // Return unconsumed quantities to stock
      const returns = consumption.filter(c => c.actual < c.picked);
      for (const r of returns) {
        const returnQty = Math.round((r.picked - r.actual) * 100) / 100;
        await base44.entities.StockMovement.create({
          product_id: r.input_product_id, product_sku: r.sku, product_name: r.name,
          qty: returnQty, uom: r.uom, reason: 'return',
          ref_type: 'production_run', ref_id: activeRun?.id,
          notes: `[task:${taskId}] Returned: picked ${r.picked}, consumed ${r.actual} ${r.uom}`,
        });
      }

      // Record unusable wastage as stock movements
      const wastageItems = consumption.filter(c => (c.unusable_wastage || 0) > 0);
      for (const w of wastageItems) {
        await base44.entities.StockMovement.create({
          product_id: w.input_product_id, product_sku: w.sku, product_name: w.name,
          qty: w.unusable_wastage, uom: w.uom, reason: 'wastage_unusable',
          ref_type: 'production_run', ref_id: activeRun?.id,
          unit_cost_at_movement: w.cost_per_unit || 0,
          notes: `[task:${taskId}] Unusable waste: ${w.unusable_wastage} ${w.uom} of ${w.name}`,
        });
      }

      // Record actual yield + cascade to downstream station
      const actualYield = meta.actual_yield;
      const plannedYield = task.qty || 0;
      let yieldNote = consumptionSummary || '';
      if (actualYield != null && task.product_id) {
        await base44.entities.StockMovement.create({
          product_id: task.product_id, product_sku: task.product_sku || '',
          product_name: task.meal_name || task.name || '',
          qty: actualYield, uom: task.qty_uom || '',
          reason: 'production_yield', ref_type: 'production_run', ref_id: activeRun?.id,
          notes: `[task:${taskId}] Yield: planned ${plannedYield}, actual ${actualYield} ${task.qty_uom || ''}`,
        });
        if (actualYield !== plannedYield) {
          yieldNote = `Yield: ${actualYield} ${task.qty_uom || ''} (planned ${plannedYield})${yieldNote ? ' | ' + yieldNote : ''}`;
        }

        // Cascade actual yield to downstream tasks (prep→cook, cook→portion)
        const nextStation = task.station === 'prep' ? 'cook' : task.station === 'cook' ? 'portion' : null;
        if (nextStation) {
          const downstream = allRunTasks.filter(
            t => t.station === nextStation && t.product_id === task.product_id && !t.archived && t.status !== 'done'
          );
          for (const dt of downstream) {
            await base44.entities.ProductionTask.update(dt.id, { qty: actualYield });
          }
        }
      }

      await base44.entities.ProductionTask.update(taskId, {
        status: 'done',
        finished_at: new Date().toISOString(),
        notes: yieldNote || consumptionSummary || undefined,
      });
    }

    setPendingDone(null);
    queryClient.invalidateQueries({ queryKey: ['kitchen-tasks', activeRun?.id, station] });
    queryClient.invalidateQueries({ queryKey: ['all-run-tasks', activeRun?.id] });
    queryClient.invalidateQueries({ queryKey: ['task-logs', activeRun?.id] });
    setUpdating(false);
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
    if (newStatus === 'in_progress') setActiveTaskId(taskId);
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
    if (newStatus === 'in_progress') setActiveTaskId(taskId);
  };

  const doStatusChange = async (taskId, newStatus) => {
    setUpdating(true);
    const now = new Date().toISOString();
    const task = tasks.find(t => t.id === taskId);

    // Log the event
    const eventMap = { in_progress: task?.status === 'paused' ? 'resumed' : 'started', paused: 'paused', done: 'completed', undo: 'undone' };
    if (task && eventMap[newStatus]) {
      logTaskEvent(task, eventMap[newStatus]);
    }

    if (newStatus === 'undo') {
      // Reverse any stock movements created when the task was completed
      const tag = `[task:${taskId}]`;
      const movements = await base44.entities.StockMovement.filter({ ref_type: 'production_run', ref_id: activeRun?.id }, '-created_date', 200);
      const taskMovements = movements.filter(m => m.notes && m.notes.includes(tag));
      for (const m of taskMovements) {
        const reverseReason = m.reason === 'return' ? 'production_consume' : 'return';
        await base44.entities.StockMovement.create({
          product_id: m.product_id,
          product_sku: m.product_sku,
          product_name: m.product_name,
          qty: m.qty,
          uom: m.uom,
          reason: reverseReason,
          ref_type: 'production_run',
          ref_id: activeRun?.id,
          notes: `[undo:${taskId}] Reversed: ${m.notes}`,
        });
      }
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

    queryClient.invalidateQueries({ queryKey: ['kitchen-tasks', activeRun?.id, station] });
    queryClient.invalidateQueries({ queryKey: ['all-run-tasks', activeRun?.id] });
    queryClient.invalidateQueries({ queryKey: ['task-logs', activeRun?.id] });
    setUpdating(false);
  };

  // Task detail view — full screen overlay
  const activeDetailTask = activeTaskId ? tasks.find(t => t.id === activeTaskId) : null;
  if (activeDetailTask) {
    return (
      <>
        <TaskDetailView
          task={activeDetailTask}
          onStatusChange={handleStatusChange}
          onBack={() => setActiveTaskId(null)}
          loading={updating}
          taskLogs={taskLogs.filter(l => l.task_id === activeDetailTask.id)}
        />
        {/* Modals still need to work in detail view */}
        {blockMessage && (
          <DependencyBlockModal message={blockMessage} onClose={() => setBlockMessage(null)} />
        )}
        {pendingDone && (
          <TaskCompletionModal task={pendingDone} onConfirm={handleTaskCompleted} onCancel={() => setPendingDone(null)} cachedBoms={allBoms} cachedComponents={allBomComponents} cachedProducts={allProducts} />
        )}
        {pendingStart && (
          <TeamMemberSelect members={teamMembers} station={station} multiSelect={pendingStart.isPortioning} onSelect={handleTeamMemberSelected} onSelectMultiple={handleTeamMultiSelected} onCancel={() => setPendingStart(null)} />
        )}
      </>
    );
  }

  // No active run
  if (!activeRun) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <KitchenTopBar station={station} taskCount={0} doneCount={0} runId={null} />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-3">
            <div className="text-6xl">🍳</div>
            <h2 className="text-2xl font-bold">No Active Run</h2>
            <p className="text-muted-foreground text-lg">
              There are no production runs in progress right now.<br />
              Ask your manager to start a run.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <KitchenTopBar
        station={station}
        runNumber={activeRun.run_number}
        taskCount={tasks.length}
        doneCount={doneCount}
        runId={activeRun.id}
      />

      {/* Progress bar */}
      {tasks.length > 0 && (
        <div className="px-4 pt-3">
          <div className="w-full bg-muted rounded-full h-3">
            <div
              className="bg-green-500 h-3 rounded-full transition-all duration-500"
              style={{ width: `${(doneCount / tasks.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {sortedTasks.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center space-y-2">
              <p className="text-xl font-semibold text-muted-foreground">No tasks for this station</p>
              <p className="text-sm text-muted-foreground">
                Check your station in Settings, or ask your manager.
              </p>
            </div>
          </div>
        ) : (
          sortedTasks.map(task => (
            <KitchenTaskCard
              key={task.id}
              task={task}
              onStatusChange={handleStatusChange}
              onTap={(id) => setActiveTaskId(id)}
              loading={updating}
              taskLogs={taskLogs.filter(l => l.task_id === task.id)}
            />
          ))
        )}

        {/* Dependency block modal */}
        {blockMessage && (
          <DependencyBlockModal
            message={blockMessage}
            onClose={() => setBlockMessage(null)}
          />
        )}

        {/* Task completion modal */}
        {pendingDone && (
          <TaskCompletionModal
            task={pendingDone}
            onConfirm={handleTaskCompleted}
            onCancel={() => setPendingDone(null)}
            cachedBoms={allBoms}
            cachedComponents={allBomComponents}
            cachedProducts={allProducts}
          />
        )}

        {/* Team member selection modal */}
        {pendingStart && (
          <TeamMemberSelect
            members={teamMembers}
            station={station}
            multiSelect={pendingStart.isPortioning}
            onSelect={handleTeamMemberSelected}
            onSelectMultiple={handleTeamMultiSelected}
            onCancel={() => setPendingStart(null)}
          />
        )}

        {/* All done celebration */}
        {tasks.length > 0 && doneCount === tasks.length && (
          <div className="bg-green-50 dark:bg-green-900/20 border-2 border-green-300 rounded-2xl p-8 text-center">
            <div className="text-5xl mb-3">✅</div>
            <h2 className="text-2xl font-bold text-green-700 dark:text-green-400">All Tasks Complete!</h2>
            <p className="text-green-600 dark:text-green-500 mt-1">Great work. Let your manager know this station is done.</p>
          </div>
        )}
      </div>
    </div>
  );
}