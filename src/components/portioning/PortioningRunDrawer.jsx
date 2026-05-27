import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44, adjustStockOnHand } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { X, Play, CheckCircle2, Loader2, UtensilsCrossed, Plus, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import AddPortioningLineModal from './AddPortioningLineModal';

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
};

export default function PortioningRunDrawer({ run, onClose, onUpdated }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [updating, setUpdating] = useState(false);
  const [showAddLine, setShowAddLine] = useState(false);

  const { data: lines = [] } = useQuery({
    queryKey: ['portioning-lines', run.id],
    queryFn: () => base44.entities.PortioningRunLine.filter({ portioning_run_id: run.id }, 'created_date', 50),
  });

  const handleStart = async () => {
    setUpdating(true);
    await base44.entities.PortioningRun.update(run.id, {
      status: 'in_progress',
      started_at: new Date().toISOString(),
    });
    toast.success('Portioning run started');
    setUpdating(false);
    onUpdated();
  };

  const handleComplete = async () => {
    if (lines.length === 0) { toast.error('Add at least one line before completing'); return; }
    setUpdating(true);

    const totalMeals = lines.reduce((s, l) => s + (l.meals_portioned || 0), 0);
    const now = new Date().toISOString();

    // Deduct WIP from stock for each portioning line
    for (const line of lines) {
      const usedKg = parseFloat(line.actual_used_kg) || 0;
      if (usedKg <= 0 || !line.bulk_product_id) continue;

      // Create stock movement for WIP consumed
      await base44.entities.StockMovement.create({
        product_id: line.bulk_product_id,
        product_name: line.bulk_product_name || '',
        product_sku: line.bulk_product_sku || '',
        qty: usedKg,
        uom: 'kg',
        reason: 'production_consume',
        ref_type: 'portioning_run',
        ref_id: run.id,
        ref_number: run.run_number || '',
        notes: `Portioning run ${run.run_number}: ${usedKg} kg of ${line.bulk_product_name} → ${line.meals_portioned || 0} meals`,
      });

      // Atomically deduct from WIP SOH
      await adjustStockOnHand(line.bulk_product_id, null, -usedKg);

      // Deduct from WipBatch qty_kg (FIFO: deduct from oldest first)
      let remaining = usedKg;
      const wipBatches = await base44.entities.WipBatch.filter(
        { bulk_product_id: line.bulk_product_id, quality_status: ['fresh', 'use_today'] },
        'produced_date',
        20
      );
      for (const batch of wipBatches) {
        if (remaining <= 0) break;
        const deduct = Math.min(remaining, batch.qty_kg || 0);
        await base44.entities.WipBatch.update(batch.id, {
          qty_kg: Math.max(0, (batch.qty_kg || 0) - deduct),
        });
        remaining -= deduct;
      }
    }

    await base44.entities.PortioningRun.update(run.id, {
      status: 'completed',
      completed_at: now,
      total_meals_portioned: totalMeals,
    });
    toast.success(`Portioning run completed — ${totalMeals} meals, WIP stock deducted`);
    setUpdating(false);
    onUpdated();
  };

  const handleUpdateLine = async (lineId, field, value) => {
    const line = lines.find(l => l.id === lineId);
    if (!line) return;
    const update = { [field]: Number(value) || 0 };
    if (field === 'actual_used_kg') {
      update.variance_kg = Math.round(((line.planned_qty_kg || 0) - (Number(value) || 0)) * 100) / 100;
      update.variance_pct = line.planned_qty_kg > 0 ? Math.round(((update.variance_kg / line.planned_qty_kg) * 100) * 10) / 10 : 0;
    }
    if (field === 'meals_portioned') {
      update.meals_portioned = Number(value) || 0;
    }
    await base44.entities.PortioningRunLine.update(lineId, update);
    queryClient.invalidateQueries({ queryKey: ['portioning-lines', run.id] });
  };

  const isDraft = run.status === 'draft';
  const isActive = run.status === 'in_progress';

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl bg-card shadow-xl flex flex-col">
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-start justify-between z-10 shrink-0">
          <div>
            <Badge className={`text-[10px] mb-1 ${STATUS_STYLES[run.status]}`}>{run.status?.replace('_', ' ')}</Badge>
            <h2 className="text-lg font-bold font-mono">{run.run_number}</h2>
            <p className="text-sm text-muted-foreground">{run.run_date}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Lines */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <UtensilsCrossed className="w-4 h-4 text-primary" /> Portioning Lines ({lines.length})
              </h3>
              {(isDraft || isActive) && (
                <Button variant="outline" size="sm" onClick={() => setShowAddLine(true)} className="gap-1">
                  <Plus className="w-3.5 h-3.5" /> Add Line
                </Button>
              )}
            </div>

            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No lines yet — add a bulk cooked product to portion</p>
            ) : (
              <div className="border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Bulk Product</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Planned (kg)</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Used (kg)</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Meals</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Variance</th>
                      <th className="text-center px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">QC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lines.map(l => (
                      <tr key={l.id}>
                        <td className="px-3 py-2">
                          <p className="font-medium">{l.bulk_product_name}</p>
                          <p className="text-[10px] font-mono text-muted-foreground">{l.bulk_product_sku}</p>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{(l.planned_qty_kg || 0).toFixed(1)}</td>
                        <td className="px-3 py-2 text-right">
                          {isActive ? (
                            <Input
                              type="number" min="0" step="0.1"
                              value={l.actual_used_kg ?? ''}
                              onChange={e => handleUpdateLine(l.id, 'actual_used_kg', e.target.value)}
                              className="h-8 w-20 text-xs text-right ml-auto"
                            />
                          ) : (
                            <span className="tabular-nums">{l.actual_used_kg ?? '—'}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isActive ? (
                            <Input
                              type="number" min="0"
                              value={l.meals_portioned ?? ''}
                              onChange={e => handleUpdateLine(l.id, 'meals_portioned', e.target.value)}
                              className="h-8 w-20 text-xs text-right ml-auto"
                            />
                          ) : (
                            <span className="tabular-nums">{l.meals_portioned || 0}</span>
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums font-medium ${
                          (l.variance_kg || 0) > 0 ? 'text-green-600' : (l.variance_kg || 0) < -1 ? 'text-red-600' : 'text-muted-foreground'
                        }`}>
                          {l.variance_kg != null ? `${l.variance_kg > 0 ? '+' : ''}${l.variance_kg.toFixed(1)} kg` : '—'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {l.qc_override_reason ? (
                            <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-600">
                              <AlertTriangle className="w-3 h-3 mr-1" /> Override
                            </Badge>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-4 shrink-0 flex gap-3 z-10">
          {isDraft && (
            <>
              <div className="flex-1" />
              <Button onClick={handleStart} disabled={updating} className="gap-2 h-11 px-6 bg-blue-600 hover:bg-blue-700">
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Start Portioning
              </Button>
            </>
          )}
          {isActive && (
            <>
              <div className="flex-1" />
              <Button onClick={handleComplete} disabled={updating} className="gap-2 h-11 px-6 bg-green-600 hover:bg-green-700">
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Complete Portioning Run
              </Button>
            </>
          )}
        </div>
      </div>

      {showAddLine && (
        <AddPortioningLineModal
          portioningRunId={run.id}
          onCreated={() => {
            setShowAddLine(false);
            queryClient.invalidateQueries({ queryKey: ['portioning-lines', run.id] });
          }}
          onCancel={() => setShowAddLine(false)}
        />
      )}
    </div>
  );
}