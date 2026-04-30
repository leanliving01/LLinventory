import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import FloorRunPicker from '@/components/floor/FloorRunPicker';
import ShortageList from '@/components/floor/shortages/ShortageList';
import SurplusPlating from '@/components/floor/shortages/SurplusPlating';
import ShortagePickModal from '@/components/floor/shortages/ShortagePickModal';
import { Link } from 'react-router-dom';

export default function FloorShortages() {
  const queryClient = useQueryClient();
  const urlRunId = useMemo(() => new URLSearchParams(window.location.search).get('runId'), []);
  const [selectedRunId, setSelectedRunId] = useState(urlRunId || null);
  const [pickItem, setPickItem] = useState(null);
  const [pickLoading, setPickLoading] = useState(false);

  const { data: runs = [], isLoading: loadingRuns } = useQuery({
    queryKey: ['floor-active-runs'],
    queryFn: () => base44.entities.ProductionRun.filter({ status: 'in_progress' }, '-run_date', 10),
  });

  useMemo(() => {
    if (runs.length === 1 && !selectedRunId) setSelectedRunId(runs[0].id);
  }, [runs]);

  const selectedRun = runs.find(r => r.id === selectedRunId);

  const { data: tasks = [], isLoading: loadingTasks } = useQuery({
    queryKey: ['shortage-tasks', selectedRunId],
    queryFn: () => base44.entities.ProductionTask.filter({ run_id: selectedRunId, archived: false }, 'step_no', 500),
    enabled: !!selectedRunId,
    refetchInterval: 15000,
  });

  const { data: runLines = [] } = useQuery({
    queryKey: ['shortage-run-lines', selectedRunId],
    queryFn: () => base44.entities.ProductionRunLine.filter({ run_id: selectedRunId }, 'product_name', 100),
    enabled: !!selectedRunId,
  });

  const { data: allBoms = [] } = useQuery({
    queryKey: ['shortage-boms'],
    queryFn: () => base44.entities.Bom.filter({ is_active: true }, '-created_date', 500),
  });

  const { data: allComponents = [] } = useQuery({
    queryKey: ['shortage-bom-components'],
    queryFn: () => base44.entities.BomComponent.list('-created_date', 3000),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['shortage-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  // Find existing shortage run for this parent
  const { data: shortageRuns = [], isLoading: loadingShortageRuns } = useQuery({
    queryKey: ['shortage-run-for-parent', selectedRunId],
    queryFn: () => base44.entities.ProductionRun.filter({ parent_run_id: selectedRunId, type: 'shortage' }, '-created_date', 5),
    enabled: !!selectedRunId,
  });

  const activeShortageRun = shortageRuns.find(r => r.status === 'in_progress' || r.status === 'scheduled' || r.status === 'draft');

  // Count tasks in the shortage run
  const { data: shortageRunTasks = [] } = useQuery({
    queryKey: ['shortage-run-tasks', activeShortageRun?.id],
    queryFn: () => base44.entities.ProductionTask.filter({ run_id: activeShortageRun.id, archived: false }, 'step_no', 100),
    enabled: !!activeShortageRun?.id,
  });

  /**
   * Find or create the shortage production run for this parent, then create a
   * production task + stock movement (pick from storage).
   */
  const handlePickShortage = async (qty) => {
    if (!pickItem || qty <= 0) return;
    setPickLoading(true);

    let shortageRun = activeShortageRun;

    // 1. Find or create shortage run
    if (!shortageRun) {
      const parentRun = selectedRun;
      const runNumber = `${parentRun?.run_number || 'RUN'}-SHORT`;
      shortageRun = await base44.entities.ProductionRun.create({
        run_number: runNumber,
        run_date: parentRun?.run_date || new Date().toISOString().split('T')[0],
        status: 'in_progress',
        type: 'shortage',
        parent_run_id: selectedRunId,
        started_at: new Date().toISOString(),
        notes: `Shortage recovery run for ${parentRun?.run_number || selectedRunId}`,
      });
    }

    // 2. Create stock movement — pick from storage (deduct raw material)
    await base44.entities.StockMovement.create({
      product_id: pickItem.product_id,
      product_sku: pickItem.sku,
      product_name: pickItem.name,
      qty: qty,
      uom: pickItem.uom,
      reason: 'production_consume',
      ref_type: 'production_run',
      ref_id: shortageRun.id,
      notes: `[shortage-pick] Picked ${qty} ${pickItem.uom} for shortage recovery (parent run: ${selectedRunId})`,
    });

    // 3. Create production task in the shortage run
    await base44.entities.ProductionTask.create({
      run_id: shortageRun.id,
      product_id: pickItem.product_id,
      product_sku: pickItem.sku,
      meal_name: pickItem.name,
      name: `${pickItem.station === 'cook' ? 'Cook' : 'Prep'} ${pickItem.name} (Shortage)`,
      station: pickItem.station,
      qty: qty,
      qty_uom: pickItem.uom,
      status: 'pending',
      step_no: (shortageRunTasks.length + 1) * 10,
    });

    // 4. Update shortage run totals
    await base44.entities.ProductionRun.update(shortageRun.id, {
      total_lines: (shortageRun.total_lines || 0) + 1,
      total_units: Math.round(((shortageRun.total_units || 0) + qty) * 100) / 100,
    });

    setPickLoading(false);
    setPickItem(null);

    // Refresh queries
    queryClient.invalidateQueries({ queryKey: ['shortage-run-for-parent', selectedRunId] });
    queryClient.invalidateQueries({ queryKey: ['shortage-run-tasks'] });
    queryClient.invalidateQueries({ queryKey: ['floor-active-runs'] });
    toast.success(`Picked ${qty} ${pickItem.uom} of ${pickItem.name} — task added to shortage run`);
  };

  if (!selectedRunId) {
    return <FloorRunPicker runs={runs} loading={loadingRuns} onSelect={setSelectedRunId} />;
  }

  if (loadingTasks) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Shortage run banner — if one exists */}
      {activeShortageRun && (
        <div className="bg-red-50 dark:bg-red-950/30 border-2 border-red-300 dark:border-red-800 rounded-2xl p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Badge className="bg-red-600 text-white border-0 text-xs">Shortage Run</Badge>
                <span className="font-bold text-sm">{activeShortageRun.run_number}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {shortageRunTasks.length} task{shortageRunTasks.length !== 1 ? 's' : ''} · {activeShortageRun.total_units || 0} units
              </p>
            </div>
            <Link to={`/floor/tasks?runId=${activeShortageRun.id}`}>
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white gap-1.5">
                Go to Tasks
              </Button>
            </Link>
          </div>
        </div>
      )}

      <ShortageList
        tasks={tasks}
        runLines={runLines}
        boms={allBoms}
        components={allComponents}
        products={products}
        onPickShortage={setPickItem}
      />
      <SurplusPlating
        tasks={tasks}
        runLines={runLines}
        boms={allBoms}
        components={allComponents}
        products={products}
        runId={selectedRunId}
      />

      {/* Pick modal */}
      {pickItem && (
        <ShortagePickModal
          item={pickItem}
          onConfirm={handlePickShortage}
          onCancel={() => setPickItem(null)}
          loading={pickLoading}
        />
      )}
    </div>
  );
}