import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Save, Loader2 } from 'lucide-react';

const EDIT_REASONS = [
  'Counting error during picking',
  'Wrong product picked',
  'Stock damaged after picking',
  'Supplier short delivery',
  'Recipe change',
  'Other',
];

/**
 * Edit a released PickLine's actual_qty_picked (post-release adjustment).
 * Accepts a PickLine entity record as `pickLine`.
 */
export default function PickListEditModal({ pickLine, onSave, onCancel }) {
  const currentQty = pickLine.actual_qty_picked || pickLine.required_qty;
  const [newQty, setNewQty] = useState(String(currentQty));
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!reason) return;
    setSaving(true);
    await onSave({
      pickLineId: pickLine.id,
      productId: pickLine.product_id,
      productName: pickLine.product_name,
      productSku: pickLine.product_sku,
      oldQty: currentQty,
      newQty: Number(newQty),
      reason,
      notes,
      uom: pickLine.required_uom,
    });
    setSaving(false);
  };

  const diff = Number(newQty) - currentQty;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative bg-card rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold">Edit Released Quantity</h3>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-4 h-4" /></Button>
        </div>

        <div className="bg-muted/50 rounded-lg p-3 text-sm">
          <p className="font-medium">{pickLine.product_name}</p>
          <p className="text-xs font-mono text-muted-foreground">{pickLine.product_sku}</p>
          <div className="flex gap-4 mt-2 text-xs">
            <span>Needed: <strong>{pickLine.required_qty} {pickLine.required_uom}</strong></span>
            <span>Currently released: <strong>{currentQty} {pickLine.required_uom}</strong></span>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase">New Qty ({pickLine.required_uom})</label>
          <Input type="number" min="0" step="any" value={newQty} onChange={e => setNewQty(e.target.value)} className="mt-1" />
          {diff !== 0 && (
            <p className={`text-xs mt-1 font-medium ${diff > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {diff > 0 ? '+' : ''}{diff.toFixed(2)} {pickLine.required_uom} {diff > 0 ? '(more from stock)' : '(returned to stock)'}
            </p>
          )}
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase">Reason *</label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Select reason..." /></SelectTrigger>
            <SelectContent>
              {EDIT_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase">Notes (optional)</label>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional detail..." className="mt-1 h-16" />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !reason || Number(newQty) === currentQty}
            className="gap-1.5"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Change
          </Button>
        </div>
      </div>
    </div>
  );
}