import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function AddPortioningLineModal({ portioningRunId, onCreated, onCancel }) {
  const [bulkProductId, setBulkProductId] = useState('');
  const [plannedKg, setPlannedKg] = useState('');
  const [qcOverrideReason, setQcOverrideReason] = useState('');
  const [saving, setSaving] = useState(false);

  // WIP batches available
  const { data: batches = [] } = useQuery({
    queryKey: ['wip-batches-for-portioning'],
    queryFn: () => base44.entities.WipBatch.list('-created_date', 500),
  });

  // Aggregate available WIP by product
  const availableProducts = useMemo(() => {
    const map = {};
    batches
      .filter(b => ['fresh', 'use_today'].includes(b.quality_status) && b.qty_kg > 0)
      .forEach(b => {
        if (!map[b.bulk_product_id]) {
          map[b.bulk_product_id] = { name: b.bulk_product_name, sku: b.bulk_product_sku, totalKg: 0, batches: [], hasNoQcToday: false };
        }
        map[b.bulk_product_id].totalKg += b.qty_kg;
        map[b.bulk_product_id].batches.push(b);
        // Check if any batch lacks today's QC
        const today = format(new Date(), 'yyyy-MM-dd');
        if (b.last_qc_date !== today) {
          map[b.bulk_product_id].hasNoQcToday = true;
        }
      });
    return map;
  }, [batches]);

  const selectedProduct = availableProducts[bulkProductId];
  const needsQcOverride = selectedProduct?.hasNoQcToday;

  const handleCreate = async () => {
    if (!bulkProductId || !plannedKg || Number(plannedKg) <= 0) {
      toast.error('Select a product and enter planned qty');
      return;
    }
    if (needsQcOverride && !qcOverrideReason.trim()) {
      toast.error('A quality check has not been done today — enter a reason to proceed');
      return;
    }

    setSaving(true);
    await base44.entities.PortioningRunLine.create({
      portioning_run_id: portioningRunId,
      bulk_product_id: bulkProductId,
      bulk_product_name: selectedProduct.name,
      bulk_product_sku: selectedProduct.sku,
      planned_qty_kg: Number(plannedKg),
      opening_qty_kg: selectedProduct.totalKg,
      qc_override_reason: needsQcOverride ? qcOverrideReason : null,
      recording_method: 'direct_used',
    });
    toast.success('Line added');
    setSaving(false);
    onCreated();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20" onClick={onCancel} />
      <div className="relative bg-card rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold">Add Portioning Line</h3>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-4 h-4" /></Button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Bulk Cooked Product</label>
            <Select value={bulkProductId} onValueChange={setBulkProductId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {Object.entries(availableProducts).map(([id, p]) => (
                  <SelectItem key={id} value={id}>{p.sku} — {p.name} ({p.totalKg.toFixed(1)} kg avail)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Planned Qty (kg)</label>
            <Input type="number" min="0.1" step="0.1" value={plannedKg} onChange={e => setPlannedKg(e.target.value)} className="mt-1" />
            {selectedProduct && (
              <p className="text-[10px] text-muted-foreground mt-1">Available: {selectedProduct.totalKg.toFixed(1)} kg across {selectedProduct.batches.length} batch(es)</p>
            )}
          </div>

          {/* QC soft warning */}
          {needsQcOverride && (
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-lg p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-amber-800">No quality check recorded today</p>
                  <p className="text-[10px] text-amber-700 mt-0.5">One or more WIP batches for this product have not been quality checked today. You may proceed, but must provide a reason.</p>
                </div>
              </div>
              <Textarea
                value={qcOverrideReason}
                onChange={e => setQcOverrideReason(e.target.value)}
                placeholder="Reason for proceeding without QC..."
                className="h-16 text-xs"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving} className="gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Add Line
          </Button>
        </div>
      </div>
    </div>
  );
}