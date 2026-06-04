import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Loader2, Pencil, Check, Star, Ruler } from 'lucide-react';
import { toast } from 'sonner';

const COUNT_UOMS = ['g', 'kg', 'ml', 'L', 'pcs', 'each', 'box', 'case', 'bag', 'drum', 'crate', 'pallet', 'tub', 'punnet'];
const UNIT_TYPES = ['weight', 'volume', 'count', 'pack'];

const EMPTY_ROW = {
  count_uom: 'kg',
  count_uom_label: '',
  unit_type: 'weight',
  conversion_factor: '',
  is_default: false,
};

function UomForm({ row, onChange, stockUom, onSave, onCancel, saving }) {
  const cf = parseFloat(row.conversion_factor);
  return (
    <div className="border border-dashed border-primary/40 rounded-lg p-4 space-y-3 bg-primary/5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Count Unit *</Label>
          <Select value={row.count_uom} onValueChange={v => onChange('count_uom', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {COUNT_UOMS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Unit Type</Label>
          <Select value={row.unit_type} onValueChange={v => onChange('unit_type', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {UNIT_TYPES.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Count Unit Name / Description</Label>
        <Input placeholder='e.g. "25kg Bag", "Crate of 12"' value={row.count_uom_label} onChange={e => onChange('count_uom_label', e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Conversion Factor * (1 {row.count_uom} = X {stockUom || 'stock units'})</Label>
        <Input
          type="number"
          step="any"
          placeholder={`e.g. 1000 (1 kg = 1000 ${stockUom || 'g'})`}
          value={row.conversion_factor}
          onChange={e => onChange('conversion_factor', e.target.value)}
        />
        {cf > 0 && (
          <p className="text-[11px] text-muted-foreground">1 {row.count_uom} counted = <span className="font-medium text-foreground">{cf} {stockUom}</span> on hand</p>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input type="checkbox" checked={row.is_default} onChange={e => onChange('is_default', e.target.checked)} className="rounded" />
        Set as the default count unit for this item
      </label>
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={onSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

export default function ProductCountUomEditor({ productId, product }) {
  const queryClient = useQueryClient();
  const stockUom = product?.stock_uom || 'unit';
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newRow, setNewRow] = useState(EMPTY_ROW);
  const [editRow, setEditRow] = useState(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['count-uoms', productId],
    queryFn: () => base44.entities.StockCountUom.filter({ product_id: productId }, 'count_uom', 50),
    enabled: !!productId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['count-uoms', productId] });

  const buildPayload = (row) => ({
    product_id: productId,
    count_uom: row.count_uom,
    count_uom_label: row.count_uom_label || '',
    unit_type: row.unit_type || null,
    conversion_factor: parseFloat(row.conversion_factor) || 1,
    is_default: !!row.is_default,
  });

  const clearOtherDefaults = async (exceptId) => {
    for (const r of rows.filter(r => r.is_default && r.id !== exceptId)) {
      await base44.entities.StockCountUom.update(r.id, { is_default: false });
    }
  };

  const handleAdd = async () => {
    if (!newRow.count_uom || !newRow.conversion_factor) { toast.error('Count unit and conversion factor are required'); return; }
    setSaving(true);
    try {
      if (newRow.is_default) await clearOtherDefaults(null);
      await base44.entities.StockCountUom.create(buildPayload(newRow));
      invalidate();
      setNewRow(EMPTY_ROW);
      setAdding(false);
      toast.success('Count unit added');
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const startEdit = (r) => {
    setEditingId(r.id);
    setEditRow({
      count_uom: r.count_uom || 'kg',
      count_uom_label: r.count_uom_label || '',
      unit_type: r.unit_type || 'weight',
      conversion_factor: String(r.conversion_factor ?? ''),
      is_default: !!r.is_default,
    });
  };

  const handleSaveEdit = async () => {
    if (!editRow.count_uom || !editRow.conversion_factor) { toast.error('Count unit and conversion factor are required'); return; }
    setSaving(true);
    try {
      if (editRow.is_default) await clearOtherDefaults(editingId);
      await base44.entities.StockCountUom.update(editingId, buildPayload(editRow));
      invalidate();
      setEditingId(null);
      setEditRow(null);
      toast.success('Count unit updated');
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    await base44.entities.StockCountUom.delete(id);
    invalidate();
    toast.success('Count unit removed');
  };

  const handleSetDefault = async (id) => {
    for (const r of rows) {
      const shouldBe = r.id === id;
      if (shouldBe !== !!r.is_default) await base44.entities.StockCountUom.update(r.id, { is_default: shouldBe });
    }
    invalidate();
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Ruler className="w-4 h-4 text-muted-foreground" /> Stock Count Units
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            How this item is counted during stock take — converts back to {stockUom}. Defaults to {stockUom} if none set.
          </p>
        </div>
        {!adding && !editingId && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="w-3.5 h-3.5" /> Add Count Unit
          </Button>
        )}
      </div>

      <div className="p-4 space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border text-[10px] uppercase text-muted-foreground">
                  <th className="text-left px-3 py-2 font-semibold">Count Unit</th>
                  <th className="text-left px-3 py-2 font-semibold">Name</th>
                  <th className="text-left px-3 py-2 font-semibold">Type</th>
                  <th className="text-right px-3 py-2 font-semibold">1 unit = ({stockUom})</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(r => editingId === r.id && editRow ? (
                  <tr key={r.id} className="bg-primary/5">
                    <td colSpan={5} className="px-3 py-3">
                      <UomForm row={editRow} onChange={(k, v) => setEditRow(p => ({ ...p, [k]: v }))} stockUom={stockUom}
                        onSave={handleSaveEdit} onCancel={() => { setEditingId(null); setEditRow(null); }} saving={saving} />
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2.5 font-medium">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => handleSetDefault(r.id)} title={r.is_default ? 'Default' : 'Set as default'}
                          className={`shrink-0 ${r.is_default ? 'text-yellow-500' : 'text-muted-foreground/30 hover:text-yellow-400'}`}>
                          <Star className="w-3.5 h-3.5" fill={r.is_default ? 'currentColor' : 'none'} />
                        </button>
                        {r.count_uom}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground text-xs">{r.count_uom_label || '—'}</td>
                    <td className="px-3 py-2.5 text-muted-foreground text-xs">{r.unit_type || '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.conversion_factor}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => startEdit(r)}><Pencil className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-destructive" onClick={() => handleDelete(r.id)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length === 0 && !adding && !isLoading && (
          <p className="text-xs text-muted-foreground py-1 italic">
            No count units defined — this item will be counted in {stockUom}.
          </p>
        )}

        {adding && (
          <UomForm row={newRow} onChange={(k, v) => setNewRow(p => ({ ...p, [k]: v }))} stockUom={stockUom}
            onSave={handleAdd} onCancel={() => { setAdding(false); setNewRow(EMPTY_ROW); }} saving={saving} />
        )}
      </div>
    </div>
  );
}
