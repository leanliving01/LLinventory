import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Save, Loader2 } from 'lucide-react';

/**
 * Simple modal to edit the planned_qty of a single production run line.
 */
export default function EditRunLineModal({ line, onSave, onCancel }) {
  const [qty, setQty] = useState(String(line.planned_qty));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const val = Number(qty);
    if (!val || val < 0) return;
    setSaving(true);
    await onSave(line.id, val);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-card rounded-xl shadow-xl border border-border w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm">Edit Planned Quantity</h3>
          <Button variant="ghost" size="icon" onClick={onCancel} className="h-7 w-7">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">{line.product_name}</p>
            <p className="text-xs text-muted-foreground font-mono">{line.product_sku}</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-semibold uppercase mb-1 block">Planned Qty</label>
            <Input
              type="number"
              min="0"
              value={qty}
              onChange={e => setQty(e.target.value)}
              className="text-right"
              autoFocus
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !qty || Number(qty) < 0} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}