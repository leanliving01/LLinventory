import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Loader2, Wrench, Clock } from 'lucide-react';
import { toast } from 'sonner';

const UOM_OPTIONS = ['g', 'kg', 'ml', 'L', 'pcs', 'trays'];

export default function ProductEquipmentTab({ productId, productName, productSku }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ equipment_id: '', max_capacity: '', capacity_uom: 'kg', cycle_time_min: '', notes: '' });

  const { data: capacities = [], isLoading } = useQuery({
    queryKey: ['equipment-capacities', productId],
    queryFn: () => base44.entities.EquipmentCapacity.filter({ product_id: productId }, 'equipment_name', 50),
    enabled: !!productId,
  });

  const { data: equipment = [] } = useQuery({
    queryKey: ['equipment-list'],
    queryFn: () => base44.entities.Equipment.filter({ status: 'active' }, 'name', 100),
  });

  const handleAdd = async () => {
    if (!form.equipment_id || !form.max_capacity) {
      toast.error('Select equipment and enter max capacity');
      return;
    }
    const eq = equipment.find(e => e.id === form.equipment_id);
    setSaving(true);
    await base44.entities.EquipmentCapacity.create({
      equipment_id: form.equipment_id,
      equipment_name: eq?.name || '',
      product_id: productId,
      product_name: productName,
      product_sku: productSku,
      max_capacity: Number(form.max_capacity),
      capacity_uom: form.capacity_uom,
      cycle_time_min: form.cycle_time_min ? Number(form.cycle_time_min) : undefined,
      notes: form.notes,
    });
    queryClient.invalidateQueries({ queryKey: ['equipment-capacities', productId] });
    setForm({ equipment_id: '', max_capacity: '', capacity_uom: 'kg', cycle_time_min: '', notes: '' });
    setAdding(false);
    setSaving(false);
    toast.success('Equipment capacity rule added');
  };

  const handleDelete = async (id) => {
    await base44.entities.EquipmentCapacity.delete(id);
    queryClient.invalidateQueries({ queryKey: ['equipment-capacities', productId] });
    toast.success('Capacity rule removed');
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Equipment Capacity Rules</h3>
          <p className="text-sm text-muted-foreground">
            Define how much of this product each piece of equipment can process per batch.
            Production tasks will auto-split when quantities exceed these limits.
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding(!adding)} className="gap-1.5">
          <Plus className="w-4 h-4" /> Add Rule
        </Button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Equipment</label>
              <Select value={form.equipment_id} onValueChange={v => setForm(f => ({ ...f, equipment_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select equipment..." /></SelectTrigger>
                <SelectContent>
                  {equipment.map(eq => (
                    <SelectItem key={eq.id} value={eq.id}>
                      {eq.name} <span className="text-muted-foreground ml-1">({eq.equipment_type})</span>
                    </SelectItem>
                  ))}
                  {equipment.length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No equipment defined yet. Add equipment in Settings → Equipment.</div>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Max Capacity</label>
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.max_capacity}
                  onChange={e => setForm(f => ({ ...f, max_capacity: e.target.value }))}
                  placeholder="e.g. 20"
                />
              </div>
              <div className="w-24">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">UoM</label>
                <Select value={form.capacity_uom} onValueChange={v => setForm(f => ({ ...f, capacity_uom: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UOM_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Cycle Time (minutes, optional)</label>
              <Input
                type="number"
                min="0"
                value={form.cycle_time_min}
                onChange={e => setForm(f => ({ ...f, cycle_time_min: e.target.value }))}
                placeholder="e.g. 45"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes (optional)</label>
              <Input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. Needs lid on"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAdd} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Existing rules */}
      {capacities.length === 0 && !adding ? (
        <div className="text-center py-12 bg-card border border-border rounded-xl">
          <Wrench className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No equipment capacity rules for this product yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Add rules to auto-split production tasks when quantities exceed equipment limits.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-[10px] text-muted-foreground uppercase">
                <th className="text-left px-4 py-2.5 font-semibold">Equipment</th>
                <th className="text-right px-3 py-2.5 font-semibold">Max Capacity</th>
                <th className="text-left px-3 py-2.5 font-semibold">UoM</th>
                <th className="text-right px-3 py-2.5 font-semibold">Cycle Time</th>
                <th className="text-left px-3 py-2.5 font-semibold">Notes</th>
                <th className="text-center px-2 py-2.5 font-semibold w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {capacities.map(cap => (
                <tr key={cap.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium">
                    <div className="flex items-center gap-2">
                      <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
                      {cap.equipment_name}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{cap.max_capacity}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline" className="text-[10px]">{cap.capacity_uom}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {cap.cycle_time_min ? (
                      <span className="flex items-center justify-end gap-1 text-muted-foreground">
                        <Clock className="w-3 h-3" /> {cap.cycle_time_min}m
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{cap.notes || '—'}</td>
                  <td className="px-2 py-2.5 text-center">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600" onClick={() => handleDelete(cap.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}