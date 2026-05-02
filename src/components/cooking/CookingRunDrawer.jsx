import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Play, CheckCircle2, Loader2, Scale, AlertTriangle, Plus, Trash2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import WastageEventForm from './WastageEventForm';

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  pending_review: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

export default function CookingRunDrawer({ run, onClose, onUpdated }) {
  const queryClient = useQueryClient();
  const [updating, setUpdating] = useState(false);
  const [rawIssued, setRawIssued] = useState(run.actual_raw_issued_kg ?? '');
  const [cookedOutput, setCookedOutput] = useState(run.actual_cooked_output_kg ?? '');
  const [notes, setNotes] = useState(run.notes || '');
  const [showWastageForm, setShowWastageForm] = useState(false);
  const [supplierId, setSupplierId] = useState(run.supplier_id || '');

  const { data: wastageEvents = [] } = useQuery({
    queryKey: ['cooking-wastage', run.id],
    queryFn: () => base44.entities.ProductionWastageEvent.filter({ cooking_run_id: run.id }, '-created_date', 50),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => base44.entities.Supplier.list('name', 100),
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['team-members'],
    queryFn: () => base44.entities.TeamMember.list('name', 50),
  });

  const totalWastage = wastageEvents.reduce((sum, e) => sum + (e.qty_kg || 0), 0);

  const calcYield = useMemo(() => {
    const raw = Number(rawIssued) || 0;
    const cooked = Number(cookedOutput) || 0;
    const effective = raw - totalWastage;
    if (effective <= 0 || cooked <= 0) return null;
    const yieldPct = (cooked / effective) * 100;
    const variance = yieldPct - (run.bom_expected_yield_pct || 0);
    const costPerKg = run.raw_cost_per_kg > 0 ? (effective * run.raw_cost_per_kg) / cooked : 0;
    return { effective, yieldPct, variance, costPerKg };
  }, [rawIssued, cookedOutput, totalWastage, run]);

  const handleStart = async () => {
    setUpdating(true);
    const selectedSupplier = suppliers.find(s => s.id === supplierId);
    await base44.entities.CookingRun.update(run.id, {
      status: 'in_progress',
      started_at: new Date().toISOString(),
      supplier_id: supplierId || null,
      supplier_name: selectedSupplier?.name || null,
    });
    toast.success('Cooking run started');
    setUpdating(false);
    onUpdated();
  };

  const handleComplete = async () => {
    const raw = Number(rawIssued);
    const cooked = Number(cookedOutput);
    if (!raw || !cooked) { toast.error('Enter raw issued and cooked output weights'); return; }

    setUpdating(true);
    const effective = raw - totalWastage;
    const yieldPct = effective > 0 ? (cooked / effective) * 100 : 0;
    const variance = yieldPct - (run.bom_expected_yield_pct || 0);
    const costPerKg = run.raw_cost_per_kg > 0 && cooked > 0 ? (effective * run.raw_cost_per_kg) / cooked : 0;
    const bomExpCostPerKg = run.bom_expected_yield_pct > 0 ? (run.raw_cost_per_kg / (run.bom_expected_yield_pct / 100)) : 0;

    // Update cooking run
    await base44.entities.CookingRun.update(run.id, {
      status: 'pending_review',
      completed_at: new Date().toISOString(),
      actual_raw_issued_kg: raw,
      actual_cooked_output_kg: cooked,
      total_wastage_kg: totalWastage,
      effective_raw_for_yield_kg: effective,
      actual_yield_pct: Math.round(yieldPct * 10) / 10,
      yield_variance_pct: Math.round(variance * 10) / 10,
      actual_cost_per_cooked_kg: Math.round(costPerKg * 100) / 100,
      bom_expected_cost_per_cooked_kg: Math.round(bomExpCostPerKg * 100) / 100,
      notes,
    });

    // Create WIP batch
    const wipBatches = await base44.entities.WipBatch.list('-created_date', 1);
    const nextBatch = wipBatches.length > 0 ?
      (parseInt((wipBatches[0].batch_number || '').replace(/\D/g, '') || '0') + 1) : 1;
    const batchNumber = `WIP-${new Date().getFullYear()}-${String(nextBatch).padStart(4, '0')}`;

    await base44.entities.WipBatch.create({
      batch_number: batchNumber,
      bulk_product_id: run.bulk_product_id,
      bulk_product_name: run.bulk_product_name,
      bulk_product_sku: run.bulk_product_sku,
      qty_kg: cooked,
      original_qty_kg: cooked,
      produced_date: run.run_date,
      cooking_run_id: run.id,
      supplier_sku: run.supplier_sku || '',
      supplier_name: run.supplier_name || '',
      carrying_cost_per_kg: Math.round(costPerKg * 100) / 100,
      total_carrying_value: Math.round(cooked * costPerKg * 100) / 100,
      quality_status: 'fresh',
    });

    // Create yield record
    const varianceThreshold = 8; // default
    await base44.entities.YieldRecord.create({
      cooking_run_id: run.id,
      production_date: run.run_date,
      run_type: 'standard',
      bulk_product_id: run.bulk_product_id,
      bulk_product_name: run.bulk_product_name,
      primary_yield_ingredient_id: run.raw_product_id || null,
      primary_yield_ingredient_name: run.raw_product_name || null,
      supplier_id: run.supplier_id || null,
      supplier_name: run.supplier_name || null,
      supplier_sku: run.supplier_sku || null,
      bom_planned_raw_kg: run.planned_raw_kg || 0,
      bom_planned_cooked_kg: run.target_output_kg || 0,
      bom_expected_yield_pct: run.bom_expected_yield_pct || 0,
      actual_raw_issued_kg: raw,
      wastage_qty_kg: totalWastage,
      effective_raw_for_yield_kg: effective,
      actual_cooked_output_kg: cooked,
      actual_yield_pct: Math.round(yieldPct * 10) / 10,
      yield_variance_pct: Math.round(variance * 10) / 10,
      raw_cost_per_kg: run.raw_cost_per_kg || 0,
      actual_cost_per_cooked_kg: Math.round(costPerKg * 100) / 100,
      bom_expected_cost_per_cooked_kg: Math.round(bomExpCostPerKg * 100) / 100,
      cost_variance_per_cooked_kg: Math.round((costPerKg - bomExpCostPerKg) * 100) / 100,
      status: 'pending_review',
      significant_variance_flag: Math.abs(variance) > varianceThreshold,
      variance_threshold_pct: varianceThreshold,
    });

    toast.success(`Run completed — WIP batch ${batchNumber} created, yield record pending review`);
    setUpdating(false);
    onUpdated();
  };

  const handleDeleteWastage = async (eventId) => {
    await base44.entities.ProductionWastageEvent.delete(eventId);
    queryClient.invalidateQueries({ queryKey: ['cooking-wastage', run.id] });
    toast.success('Wastage event removed');
  };

  const isDraft = run.status === 'draft';
  const isActive = run.status === 'in_progress';

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-card shadow-xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-start justify-between z-10 shrink-0">
          <div>
            <Badge className={`text-[10px] mb-1 ${STATUS_STYLES[run.status]}`}>{run.status?.replace('_', ' ')}</Badge>
            <h2 className="text-lg font-bold font-mono">{run.run_number}</h2>
            <p className="text-sm text-muted-foreground">{run.bulk_product_name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Info grid */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground text-xs uppercase font-semibold">Date</span><p>{run.run_date}</p></div>
            <div><span className="text-muted-foreground text-xs uppercase font-semibold">Target</span><p>{run.target_output_kg} kg</p></div>
            <div><span className="text-muted-foreground text-xs uppercase font-semibold">Raw Ingredient</span><p>{run.raw_product_name || 'Not set'}</p></div>
            <div><span className="text-muted-foreground text-xs uppercase font-semibold">Expected Yield</span><p>{run.bom_expected_yield_pct ? `${run.bom_expected_yield_pct}%` : 'N/A'}</p></div>
          </div>

          {/* Supplier selection (draft/active) */}
          {(isDraft || isActive) && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier</label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select supplier..." /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Weight capture (active only) */}
          {isActive && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Scale className="w-4 h-4 text-primary" /> Weight Capture
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Raw Issued (kg)</label>
                  <Input type="number" min="0" step="0.1" value={rawIssued} onChange={e => setRawIssued(e.target.value)} placeholder="e.g. 30" className="mt-1" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Cooked Output (kg)</label>
                  <Input type="number" min="0" step="0.1" value={cookedOutput} onChange={e => setCookedOutput(e.target.value)} placeholder="e.g. 22" className="mt-1" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Production Notes</label>
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes..." className="mt-1" />
              </div>

              {/* Yield preview */}
              {calcYield && (
                <div className="bg-muted/50 rounded-lg p-4 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase font-semibold">Effective Raw</p>
                    <p className="text-lg font-bold">{calcYield.effective.toFixed(1)} kg</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase font-semibold">Yield %</p>
                    <p className={`text-lg font-bold ${calcYield.variance > 0 ? 'text-green-600' : calcYield.variance < -5 ? 'text-red-600' : 'text-amber-600'}`}>
                      {calcYield.yieldPct.toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase font-semibold">Cost/kg</p>
                    <p className="text-lg font-bold">R {calcYield.costPerKg.toFixed(2)}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Completed stats */}
          {(run.status === 'pending_review' || run.status === 'completed') && (
            <div className="bg-muted/50 rounded-lg p-4 grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground text-xs">Raw Issued</span><p className="font-medium">{run.actual_raw_issued_kg} kg</p></div>
              <div><span className="text-muted-foreground text-xs">Cooked Output</span><p className="font-medium">{run.actual_cooked_output_kg} kg</p></div>
              <div><span className="text-muted-foreground text-xs">Wastage</span><p className="font-medium">{run.total_wastage_kg || 0} kg</p></div>
              <div><span className="text-muted-foreground text-xs">Effective Raw</span><p className="font-medium">{run.effective_raw_for_yield_kg} kg</p></div>
              <div>
                <span className="text-muted-foreground text-xs">Yield</span>
                <p className={`font-bold ${(run.yield_variance_pct || 0) > 0 ? 'text-green-600' : (run.yield_variance_pct || 0) < -5 ? 'text-red-600' : 'text-amber-600'}`}>
                  {run.actual_yield_pct}% ({run.yield_variance_pct > 0 ? '+' : ''}{run.yield_variance_pct}%)
                </p>
              </div>
              <div><span className="text-muted-foreground text-xs">Cost/kg Cooked</span><p className="font-medium">R {(run.actual_cost_per_cooked_kg || 0).toFixed(2)}</p></div>
            </div>
          )}

          {/* Wastage events */}
          {isActive && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" /> 
                  Production Wastage ({totalWastage.toFixed(1)} kg)
                </h3>
                <Button variant="outline" size="sm" onClick={() => setShowWastageForm(true)} className="gap-1">
                  <Plus className="w-3.5 h-3.5" /> Log Wastage
                </Button>
              </div>
              {wastageEvents.length > 0 ? (
                <div className="space-y-2">
                  {wastageEvents.map(e => (
                    <div key={e.id} className="flex items-center justify-between bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2 text-sm">
                      <div>
                        <span className="font-medium">{e.qty_kg} kg</span>
                        <span className="text-muted-foreground ml-2">{e.reason_code?.replace(/_/g, ' ')}</span>
                        {e.description && <span className="text-muted-foreground ml-1">— {e.description}</span>}
                      </div>
                      <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteWastage(e.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No wastage logged yet</p>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-4 shrink-0 flex gap-3 relative z-10">
          {isDraft && (
            <>
              <div className="flex-1" />
              <Button onClick={handleStart} disabled={updating} className="gap-2 h-11 px-6 bg-blue-600 hover:bg-blue-700">
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Start Cooking Run
              </Button>
            </>
          )}
          {isActive && (
            <>
              <div className="flex-1" />
              <Button 
                onClick={handleComplete} 
                disabled={updating || !rawIssued || !cookedOutput} 
                className="gap-2 h-11 px-6 bg-green-600 hover:bg-green-700"
              >
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Complete & Submit for Review
              </Button>
            </>
          )}
        </div>
      </div>

      {showWastageForm && (
        <WastageEventForm
          cookingRunId={run.id}
          rawCostPerKg={run.raw_cost_per_kg || 0}
          onCreated={() => {
            setShowWastageForm(false);
            queryClient.invalidateQueries({ queryKey: ['cooking-wastage', run.id] });
          }}
          onCancel={() => setShowWastageForm(false)}
        />
      )}
    </div>
  );
}