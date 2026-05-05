import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Gauge, Search, Scissors, CookingPot } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import PageHelp from '@/components/help/PageHelp';
import YieldStationSection from '@/components/yield-review/YieldStationSection';
import YieldHistoryDrawer from '@/components/yield-review/YieldHistoryDrawer';
import YieldRunPicker from '@/components/yield-review/YieldRunPicker';

const HELP_ITEMS = [
  { title: 'Prep & Cooking yields', text: 'This page shows yield data from completed production tasks — Prep (trim/wash loss) and Cooking (shrinkage). Portioning is excluded.' },
  { title: 'Data source', text: 'Yields are calculated from TaskConsumption records: Required qty (from recipe) vs Consumed qty (what staff entered). The yield % = consumed / required × 100.' },
  { title: 'Rolling average', text: 'The Avg (30) column shows the rolling average yield from the last 30 yield records for that product at that station.' },
  { title: 'Click for history', text: 'Click any product row to open the yield history drawer. Records below 80% are highlighted red.' },
  { title: 'Filter by run', text: 'Use the run pills to filter yield records to a specific production run.' },
];

/**
 * Build yield lines from completed production tasks + their TaskConsumption records.
 * Groups by station (prep / cook). Portioning is excluded.
 */
function buildYieldLines(tasks, consumptions, yieldRecords) {
  // Group consumptions by task_id
  const consumptionsByTask = {};
  for (const c of consumptions) {
    if (!consumptionsByTask[c.task_id]) consumptionsByTask[c.task_id] = [];
    consumptionsByTask[c.task_id].push(c);
  }

  // Group historical yield records by product+station for rolling average
  const yieldByProductStation = {};
  for (const yr of yieldRecords) {
    const key = `${yr.bulk_product_id}__${yr.station}`;
    if (!yieldByProductStation[key]) yieldByProductStation[key] = [];
    yieldByProductStation[key].push(yr);
  }

  const lines = [];

  for (const task of tasks) {
    if (task.station === 'portion') continue; // Exclude portioning
    if (task.status !== 'done') continue;

    const taskConsumptions = consumptionsByTask[task.id] || [];

    // For each consumed ingredient, create a yield line
    for (const tc of taskConsumptions) {
      const required = tc.required_qty || 0;
      const consumed = tc.consumed_qty || 0;
      const wastage = tc.wastage_qty || 0;

      if (required <= 0) continue;

      // Yield = consumed / required * 100 (how much usable output from input)
      const yieldPct = required > 0 ? (consumed / required) * 100 : 0;

      // Rolling average from stored yield records
      const histKey = `${task.product_id}__${task.station}`;
      const history = yieldByProductStation[histKey] || [];
      const rollingAvg = history.length > 0
        ? history.slice(0, 30).reduce((s, r) => s + (r.actual_yield_pct || 0), 0) / Math.min(history.length, 30)
        : null;

      const variancePct = rollingAvg != null ? yieldPct - rollingAvg : 0;

      lines.push({
        id: `${task.id}_${tc.id}`,
        task_id: task.id,
        run_id: task.run_id,
        station: task.station,
        bulk_product_id: task.product_id,
        bulk_product_name: task.meal_name || tc.input_product_name,
        bulk_product_sku: task.product_sku || tc.input_product_sku,
        input_product_id: tc.input_product_id,
        input_product_name: tc.input_product_name,
        input_product_sku: tc.input_product_sku,
        required_qty: required,
        consumed_qty: consumed,
        wastage_qty: wastage,
        uom: tc.uom,
        actual_yield_pct: yieldPct,
        rolling_avg_yield_pct: rollingAvg,
        yield_variance_pct: variancePct,
        production_date: task.finished_at ? task.finished_at.split('T')[0] : '',
        recorded_by_name: task.assigned_name || '',
        production_notes: task.notes || '',
      });
    }

    // If no consumptions but task has yield info in notes, create a line from task itself
    if (taskConsumptions.length === 0 && task.notes && task.notes.includes('Yield:')) {
      const yieldMatch = task.notes.match(/Yield:\s*([\d.]+)\s*kg\s*\(planned\s*([\d.]+)\)/);
      if (yieldMatch) {
        const actual = parseFloat(yieldMatch[1]);
        const planned = parseFloat(yieldMatch[2]);
        const yieldPct = planned > 0 ? (actual / planned) * 100 : 0;

        const histKey = `${task.product_id}__${task.station}`;
        const history = yieldByProductStation[histKey] || [];
        const rollingAvg = history.length > 0
          ? history.slice(0, 30).reduce((s, r) => s + (r.actual_yield_pct || 0), 0) / Math.min(history.length, 30)
          : null;

        lines.push({
          id: `${task.id}_notes`,
          task_id: task.id,
          run_id: task.run_id,
          station: task.station,
          bulk_product_id: task.product_id,
          bulk_product_name: task.meal_name,
          bulk_product_sku: task.product_sku,
          input_product_id: task.product_id,
          input_product_name: task.meal_name,
          input_product_sku: task.product_sku,
          required_qty: planned,
          consumed_qty: actual,
          wastage_qty: 0,
          uom: task.qty_uom || 'kg',
          actual_yield_pct: yieldPct,
          rolling_avg_yield_pct: rollingAvg,
          yield_variance_pct: rollingAvg != null ? yieldPct - rollingAvg : 0,
          production_date: task.finished_at ? task.finished_at.split('T')[0] : '',
          recorded_by_name: task.assigned_name || '',
          production_notes: task.notes || '',
        });
      }
    }
  }

  return lines;
}

export default function YieldReview() {
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const [search, setSearch] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('all');
  const [historyDrawer, setHistoryDrawer] = useState(null);

  // Load completed production runs (last 30)
  const { data: runs = [] } = useQuery({
    queryKey: ['yield-prod-runs'],
    queryFn: () => base44.entities.ProductionRun.filter(
      { status: 'completed' },
      '-run_date',
      30
    ),
  });

  // Load completed prep/cook tasks (not portion, not archived filter — just done)
  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ['yield-tasks'],
    queryFn: async () => {
      const [prepTasks, cookTasks] = await Promise.all([
        base44.entities.ProductionTask.filter({ station: 'prep', status: 'done' }, '-finished_at', 500),
        base44.entities.ProductionTask.filter({ station: 'cook', status: 'done' }, '-finished_at', 500),
      ]);
      return [...prepTasks, ...cookTasks];
    },
  });

  // Load TaskConsumption records for the loaded tasks
  const taskIds = useMemo(() => tasks.map(t => t.id), [tasks]);
  const { data: consumptions = [], isLoading: consumLoading } = useQuery({
    queryKey: ['yield-consumptions', taskIds.length],
    queryFn: () => base44.entities.TaskConsumption.list('-created_date', 2000),
    enabled: tasks.length > 0,
  });

  // Load existing yield records for rolling average calculation
  const { data: yieldRecords = [] } = useQuery({
    queryKey: ['yield-records-history'],
    queryFn: () => base44.entities.YieldRecord.list('-production_date', 500),
  });

  // Build yield lines from tasks + consumptions
  const allLines = useMemo(() => {
    if (tasks.length === 0) return [];
    // Filter consumptions to only those belonging to our loaded tasks
    const relevantConsumptions = consumptions.filter(c => taskIds.includes(c.task_id));
    return buildYieldLines(tasks, relevantConsumptions, yieldRecords);
  }, [tasks, consumptions, taskIds, yieldRecords]);

  // Apply filters
  const filtered = useMemo(() => {
    let lines = allLines;

    // Filter by run
    if (selectedRunId !== 'all') {
      lines = lines.filter(l => l.run_id === selectedRunId);
    }

    // Filter by search
    if (search) {
      const q = search.toLowerCase();
      lines = lines.filter(l =>
        (l.bulk_product_name || '').toLowerCase().includes(q) ||
        (l.bulk_product_sku || '').toLowerCase().includes(q) ||
        (l.input_product_name || '').toLowerCase().includes(q) ||
        (l.input_product_sku || '').toLowerCase().includes(q)
      );
    }

    return lines;
  }, [allLines, selectedRunId, search]);

  const prepLines = filtered.filter(l => l.station === 'prep');
  const cookLines = filtered.filter(l => l.station === 'cook');

  // Summary KPIs
  const totalLines = filtered.length;
  const avgYield = totalLines > 0
    ? filtered.reduce((s, l) => s + l.actual_yield_pct, 0) / totalLines
    : 0;
  const belowThreshold = filtered.filter(l => l.actual_yield_pct < 80).length;

  const isLoading = tasksLoading || consumLoading;

  const handleShowHistory = (productId, productName, station) => {
    setHistoryDrawer({ productId, productName, station });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Gauge className="w-6 h-6 text-primary" /> Yield Review
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Prep & cooking yields from completed production tasks — click any product for history
        </p>
      </div>

      <PageHelp items={HELP_ITEMS} />

      {/* KPI strip */}
      <div className="flex items-center gap-6 bg-card border border-border rounded-xl px-6 py-4 flex-wrap">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Yield Records</p>
          <p className="text-lg font-bold tabular-nums">{totalLines}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Avg Yield</p>
          <p className={`text-lg font-bold tabular-nums ${avgYield < 80 ? 'text-red-600' : 'text-green-600'}`}>
            {avgYield.toFixed(1)}%
          </p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-red-600 uppercase font-semibold">Below 80%</p>
          <p className={`text-lg font-bold tabular-nums ${belowThreshold > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {belowThreshold}
          </p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Prep</p>
          <p className="text-lg font-bold tabular-nums">{prepLines.length}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Cooking</p>
          <p className="text-lg font-bold tabular-nums">{cookLines.length}</p>
        </div>
      </div>

      {/* Run picker */}
      <YieldRunPicker runs={runs} selectedRunId={selectedRunId} onSelect={setSelectedRunId} />

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading yield data from production tasks...</div>
      ) : totalLines === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No yield data found. Complete production tasks with consumption data to see yields here.
        </div>
      ) : (
        <div className="space-y-4">
          <YieldStationSection
            title="Prep Yields"
            icon={Scissors}
            records={prepLines}
            onShowHistory={handleShowHistory}
          />
          <YieldStationSection
            title="Cooking Yields"
            icon={CookingPot}
            records={cookLines}
            onShowHistory={handleShowHistory}
          />
        </div>
      )}

      {historyDrawer && (
        <YieldHistoryDrawer
          productId={historyDrawer.productId}
          productName={historyDrawer.productName}
          station={historyDrawer.station}
          onClose={() => setHistoryDrawer(null)}
        />
      )}
    </div>
  );
}