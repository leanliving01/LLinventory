import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Loader2, AlertTriangle, Pencil } from 'lucide-react';
import { toast } from 'sonner';

const UOM_OPTIONS = ['kg', 'g', 'L', 'ml', 'pcs', 'box', 'case', 'each'];

/**
 * Inline editor for a single PO line's qty, unit_cost, and uom.
 * Used inside the PODetailDrawer for manual adjustments (e.g. Cumulus lump-sum invoices).
 */
export default function POLineQtyEditor({ line, onUpdated }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [qty, setQty] = useState(String(line.ordered_qty));
  const [unitCost, setUnitCost] = useState(String(line.unit_cost));
  const [uom, setUom] = useState(line.uom || 'pcs');

  const needsAttention = line.ordered_qty <= 1 && (line.line_total || 0) > 50;

  const handleSave = async () => {
    setSaving(true);
    const newQty = Number(qty);
    const newCost = Number(unitCost);
    const lineTotal = Math.round(newQty * newCost * 100) / 100;

    await base44.entities.PurchaseOrderLine.update(line.id, {
      ordered_qty: newQty,
      unit_cost: newCost,
      uom,
      line_total: lineTotal,
    });

    toast.success('Line updated');
    setSaving(false);
    setEditing(false);
    queryClient.invalidateQueries({ queryKey: ['po-lines', line.purchase_order_id] });
    if (onUpdated) onUpdated();
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex items-center gap-1 text-xs text-primary/70 hover:text-primary"
        title="Click to adjust quantity"
      >
        {needsAttention && <AlertTriangle className="w-3 h-3 text-amber-500" />}
        <Pencil className="w-3 h-3" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 py-1">
      <Input
        type="number"
        value={qty}
        onChange={e => setQty(e.target.value)}
        className="h-7 w-20 text-xs"
        min="0"
        step="any"
        placeholder="Qty"
      />
      <span className="text-[10px] text-muted-foreground">×</span>
      <Input
        type="number"
        value={unitCost}
        onChange={e => setUnitCost(e.target.value)}
        className="h-7 w-24 text-xs"
        min="0"
        step="0.01"
        placeholder="Unit cost"
      />
      <Select value={uom} onValueChange={setUom}>
        <SelectTrigger className="h-7 w-16 text-[10px] px-1.5">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UOM_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 px-2 text-xs gap-1">
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="h-7 px-2 text-xs">
        ✕
      </Button>
    </div>
  );
}