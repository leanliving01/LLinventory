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
import RunCompleteBanner from '@/components/floor/RunCompleteBanner';

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

  // Pre-fetch products so the completion modal doesn't need to (eliminates delay)
  const { data: allProducts = [] } = useQuery({
    queryKey: ['floor-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  // Live WipBatch data — source of truth for portioning availability
  const { data: wipBatches = [] } = useQuery({
    queryKey: ['floor-wip-batches'],
    queryFn: () => base44.entities.WipBatch.filter({ quality_status: 'fresh' }, 'produced_date', 200),
    refetchInterval: 10000,
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
        .map(c => `${c.name}: available ${c.picked}, used ${c.actual} ${c.uom}`);
      let notes = `Plates produced: ${meta.plates_produced || 0}`;
      if (varianceParts.length > 0) notes += ` | Variance: ${varianceParts.join('; ')}`;
      if (meta.variance_note) notes += ` | Note: ${meta.variance_note}`;

      // Handle stock movements + WipBatch deduction for ALL portioning components
      for (const item of consumption) {
        if (item.is_bulk_wip && item.actual > 0) {
          // Record the FULL consumption of bulk WIP as a stock movement
          await base44.entities.StockMovement.create({
            product_id: item.input_product_id, product_sku: item.sku, product_name: item.name,
            qty: item.actual, uom: item.uom,
            reason: 'production_consume',
            ref_type: 'production_run', ref_id: selectedRunId,
            notes: `[task:${taskId}] Bulk consumed for portioning (used ${item.actual} ${item.uom})`,
          });
          // Deduct from WipBatch (FIFO — oldest first)
          const batches = await base44.entities.WipBatch.filter(
            { bulk_product_id: item.input_product_id, quality_status: 'fresh' },
            'produced_date', 10
          );
          let remaining = item.actual;
          for (const batch of batches) {
            if (remaining <= 0) break;
            const deduct = Math.min(remaining, batch.qty_kg || 0);
            const newQty = Math.max(0, Math.round(((batch.qty_kg || 0) - deduct) * 100) / 100);
            await base44.entities.WipBatch.update(batch.id, {
              qty_kg: newQty,
              total_carrying_value: Math.round(newQty * (batch.carrying_cost_per_kg || 0) * 100) / 100,
            });
            remaining -= deduct;
          }
          // If there was leftover (actual < picked), return excess to newest batch
          const diff = Math.round((item.actual - item.picked) * 100) / 100;
          if (diff < 0) {
            await base44.entities.StockMovement.create({
              product_id: item.input_product_id, product_sku: item.sku, product_name: item.name,
              qty: Math.abs(diff), uom: item.uom,
              reason: 'production_return',
              ref_type: 'production_run', ref_id: selectedRunId,
              notes: `[task:${taskId}] Excess bulk returned (available ${item.picked}, used ${item.actual} ${item.uom})`,
            });
          }
        } else if (!item.is_bulk_wip) {
          // Packaging: only record variance movements
          const diff = Math.round((item.actual - item.picked) * 100) / 100;
          if (diff === 0) continue;
          await base44.entities.StockMovement.create({
            product_id: item.input_product_id, product_sku: item.sku, product_name: item.name,
            qty: Math.abs(diff), uom: item.uom,
            reason: diff < 0 ? 'production_return' : 'production_consume',
            ref_type: 'production_run', ref_id: selectedRunId,
            notes: `[task:${taskId}] Packaging ${diff < 0 ? 'returned' : 'consumed'} (planned ${item.picked}, used ${item.actual})`,
          });
        }
      }
      await base44.entities.ProductionTask.update(taskId, { status: 'done', finished_at: new Date().toISOString(), notes });

      // Write actual plates back to the ProductionRunLine so the Run Detail page pre-fills
      if (task.line_id && meta.plates_produced != null) {
        const plates = Number(meta.plates_produced) || 0;
        // If multiple batches exist for the same line, accumulate instead of overwrite
        if (task.total_batches > 1) {
          const lineArr = await base44.entities.ProductionRunLine.filter({ id: task.line_id });
          const existing = lineArr[0];
          const prev = existing?.actual_qty || 0;
          await base44.entities.ProductionRunLine.update(task.line_id, { actual_qty: prev + plates });
        } else {
          await base44.entities.ProductionRunLine.update(task.line_id, { actual_qty: plates });
        }
      }
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

      // Record actual yield as a production_yield stock movement
      const actualYield = meta.actual_yield;
      const plannedYield = task.qty || 0;
      let yieldNote = summary || '';
      if (actualYield != null && task.product_id) {
        await base44.entities.StockMovement.create({
          product_id: task.product_id,
          product_sku: task.product_sku || '',
          product_name: task.meal_name || task.name || '',
          qty: actualYield,
          uom: task.qty_uom || '',
          reason: 'production_yield',
          ref_type: 'production_run',
          ref_id: selectedRunId,
          notes: `[task:${taskId}] Yield: planned ${plannedYield}, actual ${actualYield} ${task.qty_uom || ''}`,
        });
        if (actualYield !== plannedYield) {
          yieldNote = `Yield: ${actualYield} ${task.qty_uom || ''} (planned ${plannedYield})${yieldNote ? ' | ' + yieldNote : ''}`;
        }

        // Create WipBatch for cook tasks (bulk cooked output becomes WIP inventory)
        if (task.station === 'cook') {
          const now = new Date();
          const year = now.getFullYear();
          const existingBatches = await base44.entities.WipBatch.filter({ bulk_product_id: task.product_id }, '-created_date', 1);
          const seq = existingBatches.length > 0 ? (existingBatches.length + 1) : 1;
          const batchNumber = `WIP-${year}-${String(seq).padStart(4, '0')}`;

          const product = allProducts.find(p => p.id === task.product_id);
          const shelfLifeHours = product?.shelf_life_hours || 72;
          const expiryAt = new Date(now.getTime() + shelfLifeHours * 3600000).toISOString();
          const minRestHours = product?.minimum_rest_time_hours || 0;
          const restReadyAt = minRestHours > 0
            ? new Date(now.getTime() + minRestHours * 3600000).toISOString()
            : now.toISOString();

          await base44.entities.WipBatch.create({
            batch_number: batchNumber,
            bulk_product_id: task.product_id,
            bulk_product_name: task.meal_name || task.name || '',
            bulk_product_sku: task.product_sku || '',
            qty_kg: actualYield,
            original_qty_kg: actualYield,
            produced_date: now.toISOString().split('T')[0],
            cooking_run_id: selectedRunId,
            quality_status: 'fresh',
            expiry_at: expiryAt,
            rest_time_met: minRestHours <= 0,
            rest_ready_at: restReadyAt,
            notes: `Created from production task — run ${selectedRun?.run_number || selectedRunId}`,
          });
          toast.success(`Bulk batch created: ${actualYield} ${task.qty_uom || 'kg'} of ${task.meal_name || task.name}`);
        }

        // Cascade actual yield to the downstream cook task (prep→cook: same product)
        if (task.station === 'prep') {
          const downstream = tasks.filter(
            t => t.station === 'cook' && t.product_id === task.product_id && !t.archived && t.status !== 'done'
          );
          for (const dt of downstream) {
            await base44.entities.ProductionTask.update(dt.id, { qty: actualYield });
          }
        }
      }

      await base44.entities.ProductionTask.update(taskId, { status: 'done', finished_at: new Date().toISOString(), notes: yieldNote || summary || undefined });
    }

    setPendingDone(null);
    setActiveDetailTaskId(null);
    setLoading(false);
    queryClient.invalidateQueries({ queryKey: ['floor-tasks', selectedRunId] });
    queryClient.invalidateQueries({ queryKey: ['floor-task-logs', selectedRunId] });
    queryClient.invalidateQueries({ queryKey: ['wip-batches'] });
    queryClient.invalidateQueries({ queryKey: ['floor-wip-batches'] });
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
          allTasks={tasks}
          allBoms={allBoms}
          allBomComponents={allBomComponents}
          wipBatches={wipBatches}
        />
        {pendingDone && <TaskCompletionModal task={pendingDone} onConfirm={handleTaskCompleted} onCancel={() => setPendingDone(null)} cachedBoms={allBoms} cachedComponents={allBomComponents} cachedProducts={allProducts} allTasks={tasks} wipBatches={wipBatches} />}
      </>
    );
  }

  const currentStation = STATIONS.find(s => s.id === selectedStation);

  // Check if ALL tasks across all stations are done
  const allTasksDone = tasks.length > 0 && tasks.every(t => t.status === 'done');

  return (
    <div className="space-y-3">
      {/* All tasks complete banner */}
      {allTasksDone && (
        <RunCompleteBanner runId={selectedRunId} runNumber={selectedRun?.run_number} />
      )}

      {/* Run header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">{selectedRun?.run_number || 'Production Run'}</h2>
          <p className="text-xs text-muted-foreground">{selectedRun?.run_date}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setSelectedRunId(null)}>
          Change Run
        </Button>
      </div>

      {/* Station pills */}
      <FloorStationPills
        tasks={tasks}
        selectedStation={selectedStation}
        onSelect={setSelectedStation}
      />

      {/* Progress bar */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{progress.done}/{progress.total} done</span>
        {progress.active > 0 && <Badge className="bg-amber-100 text-amber-700 text-[10px]">{progress.active} active</Badge>}
        <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", currentStation?.color || 'bg-primary')}
            style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Task list */}
      {loadingTasks ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : stationTasks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No {selectedStation} tasks for this run
        </div>
      ) : (
        <FloorTaskList
          tasks={stationTasks}
          allTasks={tasks}
          taskLogs={taskLogs}
          allBoms={allBoms}
          bomComponentsMap={bomComponentsMap}
          pickListConfirmed={selectedRun?.pick_list_confirmed}
          onStatusChange={handleStatusChange}
          onOpenDetail={setActiveDetailTaskId}
          loading={loading}
        />
      )}

      {/* Modals */}
      {blockMessage && <DependencyBlockModal message={blockMessage} onClose={() => setBlockMessage(null)} />}
      {pendingDone && <TaskCompletionModal task={pendingDone} onConfirm={handleTaskCompleted} onCancel={() => { setPendingDone(null); }} cachedBoms={allBoms} cachedComponents={allBomComponents} cachedProducts={allProducts} allTasks={tasks} wipBatches={wipBatches} />}
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