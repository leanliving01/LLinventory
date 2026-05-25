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
import KanbanPortionColumn from '@/components/production/KanbanPortionColumn';
import HelpDrawer from '@/components/help/HelpDrawer';
import TeamMemberSelect from '@/components/kitchen/TeamMemberSelect';
import TaskCompletionModal from '@/components/kitchen/TaskCompletionModal';
import YieldShortfallModal from '@/components/kitchen/YieldShortfallModal';
import DependencyBlockModal from '@/components/kitchen/DependencyBlockModal';
import { logTaskEvent } from '@/lib/taskEventLog';
import { checkTaskDependencies } from '@/lib/taskDependencyCheck';

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
  const [pendingDone, setPendingDone] = useState(null); // task object for completion modal
  const [blockMessage, setBlockMessage] = useState(null); // dependency error message
  const [shortfallData, setShortfallData] = useState(null); // { task, actualYield, plannedYield, affectedTasks, consumption, meta }

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

  // Load task event logs
  const { data: taskLogs = [] } = useQuery({
    queryKey: ['task-logs', runId],
    queryFn: () => base44.entities.ProductionTaskLog.filter({ run_id: runId }, 'timestamp', 2000),
    enabled: !!runId,
    refetchInterval: 15000,
  });

  // Load team members for all stations
  const { data: allTeamMembers = [] } = useQuery({
    queryKey: ['team-members-all'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }, 'name', 100),
  });

  // BOM data for component-level dependency checking
  const { data: allBoms = [] } = useQuery({
    queryKey: ['kanban-boms'],
    queryFn: () => base44.entities.Bom.filter({ is_active: true }, '-created_date', 500),
  });

  const { data: allBomComponents = [] } = useQuery({
    queryKey: ['kanban-bom-components'],
    queryFn: () => base44.entities.BomComponent.list('-created_date', 3000),
  });

  const bomComponentsMap = useMemo(() => {
    const portionBoms = allBoms.filter(b => b.bom_type === 'portion');
    const map = {};
    portionBoms.forEach(bom => {
      map[bom.product_id] = allBomComponents.filter(c => c.bom_id === bom.id);
    });
    return map;
  }, [allBoms, allBomComponents]);

  // Fetch products to build category lookup (needed for Low Carb detection)
  const productIds = useMemo(() => [...new Set(tasks.map(t => t.product_id).filter(Boolean))], [tasks]);
  const { data: products = [] } = useQuery({
    queryKey: ['kanban-products', runId],
    queryFn: () => base44.entities.Product.filter({}, 'sku', 500),
    enabled: productIds.length > 0,
  });

  // Live WipBatch data — source of truth for portioning availability
  const { data: wipBatches = [] } = useQuery({
    queryKey: ['kanban-wip-batches'],
    queryFn: () => base44.entities.WipBatch.filter({ quality_status: 'fresh' }, 'produced_date', 200),
  });

  // Build product_id → category map for package detection
  const productCategoryMap = useMemo(() => {
    const map = {};
    products.forEach(p => { if (p.category) map[p.id] = p.category; });
    return map;
  }, [products]);

  const columns = useMemo(() => {
    const cols = { prep: [], cook: [], portion: [] };
    tasks.filter(t => !t.archived).forEach(t => {
      const station = t.station || 'prep';
      if (cols[station]) cols[station].push(t);
    });
    return cols;
  }, [tasks]);

  // Dependency check — component-level for portioning
  const checkDependencies = (task) => {
    const comps = bomComponentsMap[task.product_id] || [];
    return checkTaskDependencies(task, tasks, comps, allBoms, run?.pick_list_confirmed);
  };

  const handleStatusChange = async (taskId, newStatus) => {
    const task = tasks.find(t => t.id === taskId);

    if (newStatus === 'in_progress' && task) {
      const depError = checkDependencies(task);
      if (depError) {
        setBlockMessage(depError);
        return;
      }
      // Ask for team member if starting fresh and members exist
      const memberStations = (m) => Array.isArray(m.stations) && m.stations.length > 0 ? m.stations : m.station ? [m.station] : [];
      const stationMembers = allTeamMembers.filter(m => memberStations(m).includes(task.station));
      const alreadyAssigned = task.assigned_to || (task.assigned_members && task.assigned_members !== '[]');
      if (!task.started_at && stationMembers.length > 0 && !alreadyAssigned) {
        setPendingStart({ taskId, newStatus, station: task.station, isPortioning: task.station === 'portion' });
        return;
      }
    }

    // Intercept "done" — show completion modal for actual consumption
    if (newStatus === 'done' && task) {
      setPendingDone(task);
      return;
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
  };

  /**
   * Find downstream tasks that consume this WIP product.
   * Cook tasks have product_id = WIP product. Portion tasks have product_id = finished meal.
   * We need to trace via BOM: which portion BOMs include this WIP product as a component?
   */
  const findDownstreamTasks = (task, actualYield) => {
    if (task.station === 'prep') {
      // Prep → Cook: same product_id
      return tasks.filter(
        t => t.station === 'cook' && t.product_id === task.product_id && !t.archived && t.status !== 'done'
      );
    }
    if (task.station === 'cook') {
      // Cook → Portion: different product_ids. Find portion tasks whose BOM references this WIP product.
      const wipProductId = task.product_id;
      // Find portion BOMs that reference this WIP product as an input component
      const portionBomIds = new Set();
      allBomComponents.forEach(c => {
        if (c.input_product_id === wipProductId) {
          const bom = allBoms.find(b => b.id === c.bom_id && b.bom_type === 'portion');
          if (bom) portionBomIds.add(bom.product_id); // product_id of the finished meal
        }
      });
      // Find pending/in_progress portion tasks for those finished meals
      return tasks.filter(
        t => t.station === 'portion' && portionBomIds.has(t.product_id) && !t.archived && t.status !== 'done'
      );
    }
    return [];
  };

  const handleTaskCompleted = async (taskId, consumption, meta = {}) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const isPortioningTask = consumption.length > 0 && consumption[0].is_portioning;
    const isPrepOrCook = !isPortioningTask;
    const actualYield = meta.actual_yield;
    const plannedYield = task.qty || 0;

    // Shortfall check for prep/cook: if yield < planned, warn before proceeding
    if (isPrepOrCook && actualYield != null && actualYield < plannedYield) {
      const downstream = findDownstreamTasks(task, actualYield);
      // Show warning modal — store everything needed to proceed later
      setShortfallData({ task, actualYield, plannedYield, affectedTasks: downstream, consumption, meta });
      return;
    }

    // No shortfall — proceed directly
    await executeTaskCompletion(taskId, consumption, meta);
  };

  const handleShortfallProceed = async () => {
    if (!shortfallData) return;
    const { task, consumption, meta } = shortfallData;
    setShortfallData(null);
    await executeTaskCompletion(task.id, consumption, meta);
  };

  const executeTaskCompletion = async (taskId, consumption, meta = {}) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    logTaskEvent(task, 'completed');

    const isPortioningTask = consumption.length > 0 && consumption[0].is_portioning;

    if (isPortioningTask) {
      // PORTIONING: Manual bulk WIP consumption + auto-calculated packaging
      const varianceParts = consumption
        .filter(c => c.actual !== c.picked)
        .map(c => `${c.name}: available ${c.picked}, used ${c.actual} ${c.uom}`);
      
      let notes = `Plates produced: ${meta.plates_produced || 0}`;
      if (varianceParts.length > 0) notes += ` | Variance: ${varianceParts.join('; ')}`;
      if (meta.variance_note) notes += ` | Note: ${meta.variance_note}`;

      // Handle stock movements for ALL portioning components
      for (const item of consumption) {
        const diff = Math.round((item.actual - item.picked) * 100) / 100;
        if (diff === 0) continue;

        if (item.is_bulk_wip) {
          if (diff < 0) {
            // Return excess WIP to stock — also update WipBatch
            await base44.entities.StockMovement.create({
              product_id: item.input_product_id,
              product_sku: item.sku,
              product_name: item.name,
              qty: Math.abs(diff),
              uom: item.uom,
              reason: 'production_return',
              ref_type: 'production_run',
              ref_id: runId,
              notes: `[task:${taskId}] Excess bulk returned (available ${item.picked}, used ${item.actual} ${item.uom})`,
            });
            // Return leftover to WipBatch (FIFO — find newest batch for this product)
            const batches = await base44.entities.WipBatch.filter({ bulk_product_id: item.input_product_id, quality_status: 'fresh' }, '-produced_date', 1);
            if (batches.length > 0) {
              await base44.entities.WipBatch.update(batches[0].id, {
                qty_kg: (batches[0].qty_kg || 0) + Math.abs(diff),
              });
            }
          } else {
            await base44.entities.StockMovement.create({
              product_id: item.input_product_id,
              product_sku: item.sku,
              product_name: item.name,
              qty: diff,
              uom: item.uom,
              reason: 'production_consume',
              ref_type: 'production_run',
              ref_id: runId,
              notes: `[task:${taskId}] Extra bulk consumed (available ${item.picked}, used ${item.actual} ${item.uom})`,
            });
          }
        } else {
          // Packaging: return or extra consume
          if (diff < 0) {
            await base44.entities.StockMovement.create({
              product_id: item.input_product_id,
              product_sku: item.sku,
              product_name: item.name,
              qty: Math.abs(diff),
              uom: item.uom,
              reason: 'production_return',
              ref_type: 'production_run',
              ref_id: runId,
              notes: `[task:${taskId}] Unused packaging returned (planned ${item.picked}, used ${item.actual})`,
            });
          } else {
            await base44.entities.StockMovement.create({
              product_id: item.input_product_id,
              product_sku: item.sku,
              product_name: item.name,
              qty: diff,
              uom: item.uom,
              reason: 'production_consume',
              ref_type: 'production_run',
              ref_id: runId,
              notes: `[task:${taskId}] Extra packaging consumed (planned ${item.picked}, used ${item.actual})`,
            });
          }
        }

        // Deduct WipBatch for bulk WIP portioning consumption
        if (item.is_bulk_wip && item.actual > 0) {
          const batches = await base44.entities.WipBatch.filter(
            { bulk_product_id: item.input_product_id, quality_status: 'fresh' },
            'produced_date', 10 // FIFO: oldest first
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
          product_id: r.input_product_id,
          product_sku: r.sku,
          product_name: r.name,
          qty: returnQty,
          uom: r.uom,
          reason: 'production_return',
          ref_type: 'production_run',
          ref_id: runId,
          notes: `[task:${taskId}] Returned: picked ${r.picked}, consumed ${r.actual} ${r.uom}`,
        });
      }

      // Record unusable wastage as stock movements
      const wastageItems = consumption.filter(c => (c.unusable_wastage || 0) > 0);
      for (const w of wastageItems) {
        await base44.entities.StockMovement.create({
          product_id: w.input_product_id,
          product_sku: w.sku,
          product_name: w.name,
          qty: w.unusable_wastage,
          uom: w.uom,
          reason: 'wastage_unusable',
          ref_type: 'production_run',
          ref_id: runId,
          unit_cost_at_movement: w.cost_per_unit || 0,
          notes: `[task:${taskId}] Unusable waste: ${w.unusable_wastage} ${w.uom} of ${w.name}`,
        });
      }

      // Record actual yield as a production_yield stock movement
      const actualYield = meta.actual_yield;
      const plannedYield = task.qty || 0;
      let yieldNote = consumptionSummary || '';
      if (actualYield != null && task.product_id) {
        await base44.entities.StockMovement.create({
          product_id: task.product_id,
          product_sku: task.product_sku || '',
          product_name: task.meal_name || task.name || '',
          qty: actualYield,
          uom: task.qty_uom || '',
          reason: 'production_yield',
          ref_type: 'production_run',
          ref_id: runId,
          notes: `[task:${taskId}] Yield: planned ${plannedYield}, actual ${actualYield} ${task.qty_uom || ''}`,
        });
        if (actualYield !== plannedYield) {
          yieldNote = `Yield: ${actualYield} ${task.qty_uom || ''} (planned ${plannedYield})${yieldNote ? ' | ' + yieldNote : ''}`;
        }

        // Create or update WipBatch for cook tasks (bulk cooked output becomes WIP inventory)
        if (task.station === 'cook') {
          // Generate a batch number
          const now = new Date();
          const year = now.getFullYear();
          const existingBatches = await base44.entities.WipBatch.filter({ bulk_product_id: task.product_id }, '-created_date', 1);
          const seq = existingBatches.length > 0 ? (existingBatches.length + 1) : 1;
          const batchNumber = `WIP-${year}-${String(seq).padStart(4, '0')}`;

          // Get product for shelf life
          const product = products.find(p => p.id === task.product_id);
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
            cooking_run_id: runId, // link to run
            quality_status: 'fresh',
            expiry_at: expiryAt,
            rest_time_met: minRestHours <= 0,
            rest_ready_at: restReadyAt,
            notes: `Created from production task — run ${run?.run_number || runId}`,
          });
          toast.success(`WIP batch created: ${actualYield} ${task.qty_uom || 'kg'} of ${task.meal_name || task.name}`);
        }

        // Cascade actual yield to downstream tasks (prep→cook: same product; cook→portion: trace via BOM)
        const downstream = findDownstreamTasks(task, actualYield);
        if (downstream.length > 0) {
          // For cook→portion: update the qty available. The portion task qty stays as planned (plate count),
          // but we need to know how much WIP is available. The WipBatch handles this for portioning.
          // For prep→cook: directly update cook task qty since it's the same WIP product.
          if (task.station === 'prep') {
            for (const dt of downstream) {
              await base44.entities.ProductionTask.update(dt.id, { qty: actualYield });
            }
          }
          // Cook→portion: WipBatch qty is already set above, portioning reads from WipBatch via FIFO
        }
      }

      await base44.entities.ProductionTask.update(taskId, {
        status: 'done',
        finished_at: new Date().toISOString(),
        notes: yieldNote || consumptionSummary || undefined,
      });
    }

    setPendingDone(null);
    queryClient.invalidateQueries({ queryKey: ['production-tasks', runId] });
    queryClient.invalidateQueries({ queryKey: ['task-logs', runId] });
    queryClient.invalidateQueries({ queryKey: ['wip-batches'] });
    queryClient.invalidateQueries({ queryKey: ['kanban-wip-batches'] });
    toast.success('Task completed');
  };

  const doStatusChange = async (taskId, newStatus) => {
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
      const movements = await base44.entities.StockMovement.filter({ ref_type: 'production_run', ref_id: runId }, '-created_date', 200);
      const taskMovements = movements.filter(m => m.notes && m.notes.includes(tag));
      for (const m of taskMovements) {
        const reverseReason = (m.reason === 'production_return' || m.reason === 'return') ? 'production_consume' : 'production_return';
        await base44.entities.StockMovement.create({
          product_id: m.product_id,
          product_sku: m.product_sku,
          product_name: m.product_name,
          qty: m.qty,
          uom: m.uom,
          reason: reverseReason,
          ref_type: 'production_run',
          ref_id: runId,
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
    queryClient.invalidateQueries({ queryKey: ['production-tasks', runId] });
    queryClient.invalidateQueries({ queryKey: ['task-logs', runId] });
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
          {STATIONS.map(station => {
            const Column = station.id === 'portion' ? KanbanPortionColumn : KanbanColumn;
            return (
              <Column
                key={station.id}
                station={station}
                tasks={columns[station.id] || []}
                onStatusChange={handleStatusChange}
                runId={runId}
                taskLogs={taskLogs}
                productCategoryMap={productCategoryMap}
              />
            );
          })}
        </div>
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
          cachedProducts={products}
          allTasks={tasks}
          wipBatches={wipBatches}
        />
      )}

      {/* Yield shortfall warning */}
      {shortfallData && (
        <YieldShortfallModal
          task={shortfallData.task}
          actualYield={shortfallData.actualYield}
          plannedYield={shortfallData.plannedYield}
          affectedTasks={shortfallData.affectedTasks}
          onProceed={handleShortfallProceed}
          onCancel={() => setShortfallData(null)}
        />
      )}

      {/* Team member selection modal */}
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