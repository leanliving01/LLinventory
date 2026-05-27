import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';

const REASON_OPTIONS = [
  { value: 'burned_overcooked', label: 'Burned / Overcooked' },
  { value: 'undercooked_food_safety', label: 'Undercooked / Food Safety' },
  { value: 'contaminated', label: 'Contaminated' },
  { value: 'equipment_failure', label: 'Equipment Failure' },
  { value: 'handling_dropping', label: 'Handling / Dropping' },
  { value: 'other', label: 'Other' },
];

export default function WastageEventForm({ cookingRunId, rawCostPerKg, onCreated, onCancel }) {
  const { user } = useAuth();
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!qty || Number(qty) <= 0) { toast.error('Enter a quantity'); return; }
    if (!reason) { toast.error('Select a reason'); return; }
    if (reason === 'other' && !description.trim()) { toast.error('Describe the reason'); return; }

    setSaving(true);
    const qtyKg = Number(qty);
    await base44.entities.ProductionWastageEvent.create({
      cooking_run_id: cookingRunId,
      qty_kg: qtyKg,
      reason_code: reason,
      description: description || null,
      recorded_by_name: user?.full_name || '',
      recorded_at: new Date().toISOString(),
      raw_cost_at_event: rawCostPerKg,
      total_cost: Math.round(qtyKg * rawCostPerKg * 100) / 100,
      review_status: 'pending',
    });
    toast.success(`${qtyKg} kg wastage logged`);
    setSaving(false);
    onCreated();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20" onClick={onCancel} />
      <div className="relative z-10 bg-card rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" /> Log Wastage
          </h3>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-4 h-4" /></Button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Quantity (kg)</label>
            <Input type="number" min="0.01" step="0.01" value={qty} onChange={e => setQty(e.target.value)} placeholder="e.g. 2.5" className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Reason</label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select reason..." /></SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Description {reason === 'other' && <span className="text-destructive">*</span>}</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Details..." className="mt-1" />
          </div>
          {qty && rawCostPerKg > 0 && (
            <p className="text-xs text-muted-foreground">Estimated cost: R {(Number(qty) * rawCostPerKg).toFixed(2)}</p>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2 bg-amber-600 hover:bg-amber-700">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
            Log Wastage
          </Button>
        </div>
      </div>
    </div>
  );
}