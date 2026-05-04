import React, { useState, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Pause, CheckCircle2, Play, Wrench, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import LiveTimer from '@/components/kitchen/LiveTimer';

import ConsumeTab from '@/components/floor/task-detail/ConsumeTab';
import ResourcesTab from '@/components/floor/task-detail/ResourcesTab';
import NotesTab from '@/components/floor/task-detail/NotesTab';
import FilesTab from '@/components/floor/task-detail/FilesTab';
import BomTab from '@/components/floor/task-detail/BomTab';
import AttributesTab from '@/components/floor/task-detail/AttributesTab';

const PREP_COOK_TABS = [
  { id: 'consume', label: 'To Consume' },
  { id: 'resources', label: 'Resources' },
  { id: 'notes', label: 'Notes' },
  { id: 'files', label: 'Files' },
  { id: 'bom', label: 'Recipe' },
  { id: 'attributes', label: 'Attributes' },
];

const PORTION_TABS = [
  { id: 'notes', label: 'Notes' },
  { id: 'files', label: 'Files' },
  { id: 'bom', label: 'Recipe' },
  { id: 'attributes', label: 'Attributes' },
];

/**
 * Full-page drill-down for an active production task with tabbed sections.
 */
export default function FloorTaskDetail({ task, taskLogs, onStatusChange, onBack, onDone, loading }) {
  const isPortioning = task.station === 'portion';
  const tabs = isPortioning ? PORTION_TABS : PREP_COOK_TABS;
  const [activeTab, setActiveTab] = useState(isPortioning ? 'notes' : 'consume');
  const [flushing, setFlushing] = useState(false);
  const consumeRef = useRef(null);
  const isActive = task.status === 'in_progress';
  const isPaused = task.status === 'paused';

  // Callback to receive ConsumeTab's methods via onRef
  const handleConsumeRef = useCallback((ref) => { consumeRef.current = ref; }, []);

  // Flush pending saves before opening Done modal (only for prep/cook)
  const handleDone = async (t) => {
    if (!isPortioning && consumeRef.current?.flushPendingSaves) {
      setFlushing(true);
      await consumeRef.current.flushPendingSaves();
      setFlushing(false);
    }
    onDone(t);
  };

  // Fetch BOM for this product + station.
  // Prep and cook tasks both belong to the Cook BOM layer. Portion tasks use their own Portion BOM.
  const bomType = task.station === 'portion' ? 'portion' : 'cook';
  const { data: boms = [] } = useQuery({
    queryKey: ['task-bom', task.product_id, bomType],
    queryFn: () => base44.entities.Bom.filter({ product_id: task.product_id, bom_type: bomType, is_active: true }),
    enabled: !!task.product_id,
  });
  const bom = boms[0] || null;

  // Fetch BOM components
  const { data: components = [] } = useQuery({
    queryKey: ['task-bom-components', bom?.id],
    queryFn: () => base44.entities.BomComponent.filter({ bom_id: bom.id }),
    enabled: !!bom?.id,
  });

  // Fetch BOM operations
  const { data: operations = [] } = useQuery({
    queryKey: ['task-bom-operations', bom?.id],
    queryFn: () => base44.entities.BomOperation.filter({ bom_id: bom.id }, 'step_no', 50),
    enabled: !!bom?.id,
  });

  // Filter components by step assignment: show only ingredients for this task's step (or "all steps")
  const stepFilteredComponents = useMemo(() => {
    const taskStep = task.step_no || 0;
    if (taskStep <= 0) return components; // no step = show all
    return components.filter(c => !c.step_no || c.step_no === taskStep);
  }, [components, task.step_no]);

  const stationLabel = { prep: 'Preparation', cook: 'Cooking', portion: 'Portioning' }[task.station] || task.station;
  const stationColor = { prep: 'bg-blue-500', cook: 'bg-amber-500', portion: 'bg-green-500' }[task.station] || 'bg-primary';
  const btnColor = { prep: 'bg-blue-500 hover:bg-blue-600', cook: 'bg-amber-500 hover:bg-amber-600', portion: 'bg-green-500 hover:bg-green-600' }[task.station] || 'bg-primary';

  return (
    <div className="space-y-3">
      {/* Header: back + station badge */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0 -ml-2">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <Badge className={cn("text-white text-xs", stationColor)}>{stationLabel}</Badge>
      </div>

      {/* Task title card with timer */}
      <div className="bg-card border-2 border-border rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold leading-tight">{task.meal_name || task.name}</h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {task.product_sku && (
                <span className="text-xs font-mono text-muted-foreground">{task.product_sku}</span>
              )}
              {task.name && task.meal_name && task.name !== task.meal_name && (
                <Badge variant="outline" className="text-[10px]">{task.name}</Badge>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold tabular-nums">
              {task.qty != null ? (Number.isInteger(task.qty) ? task.qty : Number(task.qty).toFixed(2)) : '—'}
            </div>
            <span className="text-[10px] text-muted-foreground">{task.qty_uom || (task.station === 'portion' ? 'pcs' : 'units')}</span>
          </div>
        </div>

        {/* Timer row */}
        <div className="flex items-center justify-between bg-muted/50 rounded-xl px-3 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            {task.total_batches > 1 && (
              <Badge className="bg-purple-100 text-purple-700 text-[10px]">Batch {task.batch_number}/{task.total_batches}</Badge>
            )}
            {task.equipment_name && (
              <Badge variant="outline" className="text-[10px] gap-0.5"><Wrench className="w-2.5 h-2.5" /> {task.equipment_name}</Badge>
            )}
            {task.assigned_name && (
              <Badge variant="outline" className="text-[10px]">{task.assigned_name}</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isActive && task.started_at && (
              <>
                <Clock className="w-4 h-4 text-amber-500" />
                <LiveTimer startedAt={task.started_at} isActive={true} logs={taskLogs} className="font-mono text-lg font-bold text-amber-600 dark:text-amber-400 tabular-nums" />
              </>
            )}
            {isPaused && task.started_at && (
              <>
                <Pause className="w-4 h-4 text-blue-600" />
                <LiveTimer startedAt={task.started_at} isActive={false} logs={taskLogs} className="font-mono text-lg font-bold text-blue-600 tabular-nums" />
                <Badge className="bg-blue-100 text-blue-700 text-[10px]">PAUSED</Badge>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors",
              activeTab === tab.id
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-[200px]">
        {activeTab === 'consume' && <ConsumeTab task={task} bom={bom} components={stepFilteredComponents} onRef={handleConsumeRef} />}
        {activeTab === 'resources' && <ResourcesTab task={task} operations={operations} />}
        {activeTab === 'notes' && <NotesTab task={task} bom={bom} operations={operations} />}
        {activeTab === 'files' && <FilesTab bom={bom} />}
        {activeTab === 'bom' && <BomTab bom={bom} components={components} operations={operations} taskQty={task.qty} />}
        {activeTab === 'attributes' && <AttributesTab task={task} />}
      </div>

      {/* Action buttons — sticky bottom */}
      <div className="sticky bottom-0 pb-4 pt-2 bg-background/95 backdrop-blur-sm flex items-center gap-3">
        {isActive && (
          <>
            <Button disabled={loading} variant="outline" onClick={() => onStatusChange(task.id, 'paused')}
              className="h-14 flex-1 gap-2 text-lg font-bold rounded-xl">
              <Pause className="w-6 h-6" /> Pause
            </Button>
            <Button disabled={loading || flushing} onClick={() => handleDone(task)}
              className="h-14 flex-1 gap-2 text-lg font-bold bg-green-600 hover:bg-green-700 rounded-xl text-white">
              {flushing ? <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...</> : <><CheckCircle2 className="w-6 h-6" /> Done</>}
            </Button>
          </>
        )}
        {isPaused && (
          <Button disabled={loading} onClick={() => onStatusChange(task.id, 'in_progress')}
            className={`h-14 flex-1 gap-2 text-lg font-bold rounded-xl text-white ${btnColor}`}>
            <Play className="w-6 h-6" /> Resume
          </Button>
        )}
      </div>
    </div>
  );
}