import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Package, Zap } from 'lucide-react';
import { toast } from 'sonner';

/**
 * "To Consume" tab — shows BOM components with Required / Consumed / Wastage fields.
 * Staff can edit consumed & wastage. Auto-consume sets consumed = required for all.
 */
export default function ConsumeTab({ task, bom, components }) {
  const queryClient = useQueryClient();
  const scale = bom?.yield_qty ? (task.qty || 1) / bom.yield_qty : 1;

  const scaledComponents = useMemo(() => {
    if (!components || components.length === 0) return [];
    return components.map(c => ({
      ...c,
      required: Math.round(c.qty * scale * 100) / 100,
    }));
  }, [components, scale]);

  // Fetch existing TaskConsumption records for this task
  const { data: existing = [] } = useQuery({
    queryKey: ['task-consumption', task.id],
    queryFn: () => base44.entities.TaskConsumption.filter({ task_id: task.id }),
    enabled: !!task.id,
  });

  // Local state: { [bom_component_id]: { consumed, wastage } }
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);

  // Seed local state from existing records
  useEffect(() => {
    if (existing.length === 0 && scaledComponents.length === 0) return;
    const map = {};
    scaledComponents.forEach(c => {
      const rec = existing.find(e => e.bom_component_id === c.id);
      map[c.id] = {
        consumed: rec ? rec.consumed_qty : 0,
        wastage: rec ? rec.wastage_qty : 0,
        recordId: rec?.id || null,
      };
    });
    setValues(map);
  }, [existing, scaledComponents]);

  const updateField = (compId, field, val) => {
    setValues(prev => ({
      ...prev,
      [compId]: { ...prev[compId], [field]: parseFloat(val) || 0 },
    }));
  };

  const autoConsume = () => {
    const map = {};
    scaledComponents.forEach(c => {
      map[c.id] = { ...values[c.id], consumed: c.required };
    });
    setValues(map);
  };

  const saveAll = async () => {
    setSaving(true);
    for (const comp of scaledComponents) {
      const v = values[comp.id] || { consumed: 0, wastage: 0 };
      const data = {
        task_id: task.id,
        run_id: task.run_id,
        bom_component_id: comp.id,
        input_product_id: comp.input_product_id,
        input_product_sku: comp.input_product_sku || '',
        input_product_name: comp.input_product_name || '',
        required_qty: comp.required,
        consumed_qty: v.consumed,
        wastage_qty: v.wastage,
        uom: comp.uom,
      };
      if (v.recordId) {
        await base44.entities.TaskConsumption.update(v.recordId, data);
      } else {
        await base44.entities.TaskConsumption.create(data);
      }
    }
    queryClient.invalidateQueries({ queryKey: ['task-consumption', task.id] });
    setSaving(false);
    toast.success('Consumption saved');
  };

  if (scaledComponents.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-muted-foreground text-sm">No recipe components found for this task.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Auto-consume button */}
      <Button variant="outline" size="sm" onClick={autoConsume} className="w-full gap-2">
        <Zap className="w-4 h-4" /> Auto-consume (set all to required)
      </Button>

      {/* Component rows */}
      {scaledComponents.map(c => {
        const v = values[c.id] || { consumed: 0, wastage: 0 };
        return (
          <div key={c.id} className="bg-card border rounded-2xl p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-sm">{c.input_product_name}</p>
                <p className="text-xs font-mono text-muted-foreground">{c.input_product_sku}</p>
              </div>
              {c.is_consumable && (
                <Badge className="bg-purple-100 text-purple-700 text-[10px] shrink-0">Consumable</Badge>
              )}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Required:</span>
              <span className="font-bold tabular-nums">{c.required} {c.uom}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground shrink-0">Consumed:</span>
              <Input
                type="number"
                step="0.01"
                value={v.consumed || ''}
                onChange={(e) => updateField(c.id, 'consumed', e.target.value)}
                className="h-10 w-28 text-right tabular-nums font-semibold"
                placeholder="0"
              />
              <span className="text-xs text-muted-foreground shrink-0">{c.uom}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground shrink-0">Wastage:</span>
              <Input
                type="number"
                step="0.01"
                value={v.wastage || ''}
                onChange={(e) => updateField(c.id, 'wastage', e.target.value)}
                className="h-10 w-28 text-right tabular-nums font-semibold"
                placeholder="0"
              />
              <span className="text-xs text-muted-foreground shrink-0">{c.uom}</span>
            </div>
          </div>
        );
      })}

      {/* Save button */}
      <Button onClick={saveAll} disabled={saving} className="w-full h-14 text-lg font-bold rounded-xl">
        {saving ? 'Saving…' : 'Save Consumption'}
      </Button>
    </div>
  );
}