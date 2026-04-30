import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';
import FloorRunPicker from '@/components/floor/FloorRunPicker';
import ShortageList from '@/components/floor/shortages/ShortageList';
import SurplusPlating from '@/components/floor/shortages/SurplusPlating';

export default function FloorShortages() {
  const urlRunId = useMemo(() => new URLSearchParams(window.location.search).get('runId'), []);
  const [selectedRunId, setSelectedRunId] = useState(urlRunId || null);

  const { data: runs = [], isLoading: loadingRuns } = useQuery({
    queryKey: ['floor-active-runs'],
    queryFn: () => base44.entities.ProductionRun.filter({ status: 'in_progress' }, '-run_date', 10),
  });

  useMemo(() => {
    if (runs.length === 1 && !selectedRunId) setSelectedRunId(runs[0].id);
  }, [runs]);

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
      <ShortageList
        tasks={tasks}
        runLines={runLines}
        boms={allBoms}
        components={allComponents}
        products={products}
      />
      <SurplusPlating
        tasks={tasks}
        runLines={runLines}
        boms={allBoms}
        components={allComponents}
        products={products}
        runId={selectedRunId}
      />
    </div>
  );
}