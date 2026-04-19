import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function EditSkuCodeDialog({ open, onClose, sku, onSaved }) {
  const [newCode, setNewCode] = useState(sku?.sku_code || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = newCode.trim();
    if (!trimmed || trimmed === sku.sku_code) {
      onClose();
      return;
    }
    setSaving(true);
    await base44.entities.SKU.update(sku.id, { sku_code: trimmed });
    toast.success(`SKU code updated: ${sku.sku_code} → ${trimmed}`);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit SKU Code</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs text-muted-foreground">Meal</Label>
            <p className="text-sm font-medium">{sku?.meal_name}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Package Type</Label>
            <p className="text-sm font-medium">{sku?.package_type}</p>
          </div>
          <div>
            <Label htmlFor="skuCode">SKU Code</Label>
            <Input
              id="skuCode"
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              placeholder="e.g. MWL-001"
              className="mt-1 font-mono"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !newCode.trim()}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}