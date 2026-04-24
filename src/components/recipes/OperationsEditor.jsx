import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Wrench, Plus, Trash2, GripVertical, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const STATIONS = ['prep', 'cook', 'portion'];

export default function OperationsEditor({ bomId }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [newStep, setNewStep] = useState({ name: '', station: 'cook', cycle_time_min: '', notes: '' });

  const { data: operations = [], isLoading } = useQuery({
    queryKey: ['bom-operations', bomId],
    queryFn: () => base44.entities.BomOperation.filter({ bom_id: bomId }),
  });

  const sorted = [...operations].sort((a, b) => (a.step_no || 0) - (b.step_no || 0));

  const handleDelete = async (op) => {
    if (!window.confirm(`Remove step "${op.name}"?`)) return;
    await base44.entities.BomOperation.delete(op.id);
    queryClient.invalidateQueries({ queryKey: ['bom-operations', bomId] });
    toast.success('Step removed');
  };

  const handleAddStep = async () => {
    if (!newStep.name.trim()) return;
    setSaving(true);
    const nextStepNo = sorted.length > 0 ? (sorted[sorted.length - 1].step_no || sorted.length) + 1 : 1;
    await base44.entities.BomOperation.create({
      bom_id: bomId,
      step_no: nextStepNo,
      name: newStep.name.trim(),
      station: newStep.station,
      cycle_time_min: newStep.cycle_time_min ? Number(newStep.cycle_time_min) : undefined,
      notes: newStep.notes || undefined,
    });
    setNewStep({ name: '', station: 'cook', cycle_time_min: '', notes: '' });
    setAddingNew(false);
    queryClient.invalidateQueries({ queryKey: ['bom-operations', bomId] });
    toast.success('Step added');
    setSaving(false);
  };

  const handleUpdateStep = async (op, field, value) => {
    await base44.entities.BomOperation.update(op.id, { [field]: value });
    queryClient.invalidateQueries({ queryKey: ['bom-operations', bomId] });
  };

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading steps...</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Wrench className="w-4 h-4 text-primary" />
          Steps ({sorted.length})
        </h3>
        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={() => setAddingNew(true)}>
          <Plus className="w-3 h-3" /> Add Step
        </Button>
      </div>

      {sorted.length === 0 && !addingNew && (
        <p className="text-xs text-muted-foreground mb-3">No steps defined. Add steps to define the production workflow.</p>
      )}

      <div className="space-y-2">
        {sorted.map((op) => (
          <div key={op.id} className="flex items-start gap-2 bg-muted/30 rounded-lg px-3 py-2.5">
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
              {op.step_no}
            </span>
            <div className="flex-1 min-w-0 space-y-1">
              <Input
                defaultValue={op.name}
                onBlur={e => { if (e.target.value !== op.name) handleUpdateStep(op, 'name', e.target.value); }}
                className="h-7 text-sm font-medium"
              />
              <div className="flex items-center gap-2">
                <Select defaultValue={op.station} onValueChange={v => handleUpdateStep(op, 'station', v)}>
                  <SelectTrigger className="h-6 text-[11px] w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATIONS.map(s => <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  placeholder="min"
                  defaultValue={op.cycle_time_min || ''}
                  onBlur={e => handleUpdateStep(op, 'cycle_time_min', e.target.value ? Number(e.target.value) : null)}
                  className="h-6 w-16 text-[11px]"
                />
                <span className="text-[10px] text-muted-foreground">min</span>
              </div>
              {op.notes && (
                <p className="text-[10px] text-muted-foreground truncate">{op.notes}</p>
              )}
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0" onClick={() => handleDelete(op)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}

        {/* Add new step form */}
        {addingNew && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
            <Input
              placeholder="Step name (e.g. Marinate Chicken)"
              value={newStep.name}
              onChange={e => setNewStep(prev => ({ ...prev, name: e.target.value }))}
              className="h-8 text-sm"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Select value={newStep.station} onValueChange={v => setNewStep(prev => ({ ...prev, station: v }))}>
                <SelectTrigger className="h-7 text-xs w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATIONS.map(s => <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="Time (min)"
                value={newStep.cycle_time_min}
                onChange={e => setNewStep(prev => ({ ...prev, cycle_time_min: e.target.value }))}
                className="h-7 w-24 text-xs"
              />
            </div>
            <Input
              placeholder="Notes (optional)"
              value={newStep.notes}
              onChange={e => setNewStep(prev => ({ ...prev, notes: e.target.value }))}
              className="h-7 text-xs"
            />
            <div className="flex gap-2 pt-1">
              <Button size="sm" className="h-7 text-xs gap-1" onClick={handleAddStep} disabled={saving || !newStep.name.trim()}>
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Add
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAddingNew(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}