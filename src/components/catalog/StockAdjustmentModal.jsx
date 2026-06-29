import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44, adjustStockOnHand } from '@/api/base44Client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, Plus, Minus } from 'lucide-react';
import { useUnsavedChanges, useGuardedAction } from '@/lib/navigationGuard';

const REASONS = [
  { value: 'receipt', label: 'Stock Received', direction: 'in' },
  { value: 'stocktake_adjustment', label: 'Stock Take Adjustment', direction: 'both' },
  { value: 'wastage_unusable', label: 'Wastage (Unusable)', direction: 'out' },
  { value: 'write_off', label: 'Write Off', direction: 'out' },
  { value: 'return', label: 'Customer Return', direction: 'in' },
];

export default function StockAdjustmentModal({ product, onClose }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('stocktake_adjustment');
  const [direction, setDirection] = useState('in');
  const [qty, setQty] = useState('');
  const [locationId, setLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.list(),
  });

  const stockBearingLocations = useMemo(
    () => locations.filter(l => l.is_stock_bearing !== false),
    [locations]
  );

  // Auto-select default location
  React.useEffect(() => {
    if (!locationId && product?.default_location_id) {
      setLocationId(product.default_location_id);
    } else if (!locationId && stockBearingLocations.length > 0) {
      setLocationId(stockBearingLocations[0].id);
    }
  }, [stockBearingLocations, product]);

  // Lock direction for reason types that are one-way
  const selectedReason = REASONS.find(r => r.value === reason);
  React.useEffect(() => {
    if (selectedReason?.direction === 'in') setDirection('in');
    else if (selectedReason?.direction === 'out') setDirection('out');
  }, [reason]);

  const handleSave = async () => {
    const numQty = Number(qty);
    if (!numQty || numQty <= 0 || !locationId) return;
    setSaving(true);

    try {
      const loc = locations.find(l => l.id === locationId);
      const uom = product.stock_uom || 'pcs';
      const delta = direction === 'in' ? numQty : -numQty;

      // Create append-only stock movement
      await base44.entities.StockMovement.create({
        product_id: product.id,
        product_sku: product.sku,
        product_name: product.name,
        qty: numQty,
        uom,
        reason,
        ref_type: 'manual',
        ...(direction === 'in'
          ? { to_location_id: locationId }
          : { from_location_id: locationId }),
        notes: notes || `Manual adjustment from product page`,
      });

      // Atomically adjust StockOnHand
      await adjustStockOnHand(product.id, locationId, delta);

      queryClient.invalidateQueries({ queryKey: ['product-stock', product.id] });
      queryClient.invalidateQueries({ queryKey: ['product-movements', product.id] });

      toast.success(
        `${direction === 'in' ? 'Added' : 'Removed'} ${numQty} ${uom}` +
        `${loc ? ` ${direction === 'in' ? 'to' : 'from'} ${loc.name}` : ''} — stock updated`
      );
    } catch (err) {
      // Keep the modal open on failure so the user sees the error and can retry.
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
      setSaving(false);
      return;
    }

    setSaving(false);
    onClose();
  };

  const canSave = Number(qty) > 0 && locationId;

  // Unsaved-changes guard: dirty once the user has typed a quantity or notes
  // (location/reason carry defaults, so they aren't user-intent signals).
  const isDirty = qty.trim() !== '' || notes.trim() !== '';
  useUnsavedChanges(isDirty, {
    message: 'You have an unsaved stock adjustment. Leave without saving?',
  });
  const guardedClose = useGuardedAction();

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
      onClick={() => guardedClose(onClose)}
    >
      <div
        className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-lg font-bold">Adjust Stock</h3>
          <Button variant="ghost" size="icon" onClick={() => guardedClose(onClose)}><X className="w-5 h-5" /></Button>
        </div>

        <div className="p-6 space-y-4">
          {/* Product info */}
          <div className="bg-muted/50 rounded-lg px-4 py-3">
            <p className="text-sm font-semibold">{product.name}</p>
            <p className="text-xs text-muted-foreground font-mono">{product.sku} · {product.stock_uom}</p>
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Reason</label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASONS.map(r => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Direction (only for bi-directional reasons) */}
          {selectedReason?.direction === 'both' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase">Direction</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setDirection('in')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    direction === 'in'
                      ? 'border-green-500 bg-green-50 text-green-700 ring-1 ring-green-300'
                      : 'border-border hover:bg-muted/30'
                  }`}
                >
                  <Plus className="w-4 h-4" /> Add Stock
                </button>
                <button
                  onClick={() => setDirection('out')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    direction === 'out'
                      ? 'border-red-500 bg-red-50 text-red-700 ring-1 ring-red-300'
                      : 'border-border hover:bg-muted/30'
                  }`}
                >
                  <Minus className="w-4 h-4" /> Remove Stock
                </button>
              </div>
            </div>
          )}

          {/* Location */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Location</label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
              <SelectContent>
                {stockBearingLocations.map(l => (
                  <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quantity */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase">
              Quantity ({product.stock_uom})
            </label>
            <Input
              type="number"
              step="any"
              min="0"
              placeholder="0"
              value={qty}
              onChange={e => setQty(e.target.value)}
              className="text-lg font-bold tabular-nums"
              autoFocus
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Notes (optional)</label>
            <Input
              placeholder="Reason for adjustment..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => guardedClose(onClose)}>Cancel</Button>
          <Button
            className="flex-1 gap-2"
            onClick={handleSave}
            disabled={saving || !canSave}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {direction === 'in' ? 'Add Stock' : 'Remove Stock'}
          </Button>
        </div>
      </div>
    </div>
  );
}