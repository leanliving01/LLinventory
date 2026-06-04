import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44, adjustStockOnHand } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, X, Search, Loader2, Plus, Minus } from 'lucide-react';
import { toast } from 'sonner';
import { formatZAR } from '@/lib/utils';
import { writeAuditLog } from '@/lib/auditLog';
import { nextDocNumber } from '@/lib/docNumbering';

// Manual adjustment reasons → StockMovement reason enum mapping + default direction.
// direction 'in' = add stock, 'out' = remove stock, 'both' = computed from delta.
export const ADJUST_REASONS = [
  { value: 'damaged', label: 'Damaged', movementReason: 'wastage_unusable', direction: 'out' },
  { value: 'wastage', label: 'Wastage', movementReason: 'wastage_unusable', direction: 'out' },
  { value: 'write_off', label: 'Write Off', movementReason: 'write_off', direction: 'out' },
  { value: 'internal_use', label: 'Internal Use', movementReason: 'wastage_unusable', direction: 'out' },
  { value: 'value_correction', label: 'Value Correction', movementReason: 'stocktake_adjustment', direction: 'both' },
  { value: 'stock_found', label: 'Stock Found', movementReason: 'stocktake_adjustment', direction: 'in' },
  { value: 'other', label: 'Other', movementReason: 'stocktake_adjustment', direction: 'both' },
];

export const ADJUST_REASON_LABELS = ADJUST_REASONS.reduce((acc, r) => {
  acc[r.value] = r.label;
  return acc;
}, {});

export default function StockAdjustForm({ user, canAdjustValue = false, onCreated, onCancel }) {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [locationId, setLocationId] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  // entry mode: 'target' (enter new on-hand) or 'delta' (enter +/- change)
  const [mode, setMode] = useState('delta');
  const [targetQty, setTargetQty] = useState('');
  const [deltaQty, setDeltaQty] = useState('');
  const [deltaSign, setDeltaSign] = useState('out'); // 'in' | 'out'
  const [unitCostInput, setUnitCostInput] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ['products-adjust-search'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['stock-bearing-locations'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 200),
  });

  // Current on-hand for the chosen product + location
  const { data: sohRows = [] } = useQuery({
    queryKey: ['stock-on-hand', selectedProduct?.id],
    queryFn: () => base44.entities.StockOnHand.filter({ product_id: selectedProduct.id }),
    enabled: !!selectedProduct?.id,
  });

  const currentSoh = useMemo(() => {
    if (!locationId) return null;
    return sohRows.find(r => r.location_id === locationId) || null;
  }, [sohRows, locationId]);

  const currentQty = currentSoh ? Number(currentSoh.qty_on_hand || 0) : 0;
  const lastCost = selectedProduct ? (selectedProduct.cost_avg ?? selectedProduct.cost_current ?? 0) : 0;

  const selectedReason = ADJUST_REASONS.find(r => r.value === reason);

  // When a fixed-direction reason is picked, lock the delta sign to match.
  useEffect(() => {
    if (selectedReason?.direction === 'in') setDeltaSign('in');
    else if (selectedReason?.direction === 'out') setDeltaSign('out');
  }, [reason]);

  // Default location to the first one
  useEffect(() => {
    if (!locationId && locations.length > 0) setLocationId(locations[0].id);
  }, [locations]);

  const filteredProducts = useMemo(() => {
    if (!search || search.length < 2) return [];
    const s = search.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s)
    ).slice(0, 15);
  }, [products, search]);

  // Compute signed delta (positive = add, negative = remove)
  const signedDelta = useMemo(() => {
    if (mode === 'target') {
      if (targetQty === '' || isNaN(Number(targetQty))) return 0;
      return Number(targetQty) - currentQty;
    }
    if (deltaQty === '' || isNaN(Number(deltaQty))) return 0;
    const mag = Math.abs(Number(deltaQty));
    return deltaSign === 'in' ? mag : -mag;
  }, [mode, targetQty, deltaQty, deltaSign, currentQty]);

  const resultingQty = currentQty + signedDelta;
  const isValueOnly = reason === 'value_correction' && signedDelta === 0;

  const handleSelectProduct = (product) => {
    setSelectedProduct(product);
    setSearch('');
    setUnitCostInput('');
  };

  const handleSave = async () => {
    if (!selectedProduct) { toast.error('Select a product'); return; }
    if (!locationId) { toast.error('Select a location'); return; }
    if (!reason) { toast.error('A reason is required'); return; }
    if (!notes.trim()) { toast.error('Notes are required for an adjustment'); return; }

    const hasValueEdit = canAdjustValue && unitCostInput !== '' && !isNaN(Number(unitCostInput));

    if (signedDelta === 0 && !(reason === 'value_correction' && hasValueEdit)) {
      toast.error('No change — enter a quantity adjustment or a value correction');
      return;
    }
    if (resultingQty < 0) {
      toast.error('Adjustment would make on-hand negative');
      return;
    }

    setSaving(true);
    try {
      const product = selectedProduct;
      const uom = product.stock_uom || 'pcs';
      const reasonLabel = selectedReason?.label || reason;
      const movementReason = selectedReason?.movementReason || 'stocktake_adjustment';
      const newCost = hasValueEdit ? Number(unitCostInput) : null;
      // Unit cost recorded on the movement: explicit value edit, else last cost.
      const unitCostAtMovement = newCost != null ? newCost : lastCost;

      const refNumber = await nextDocNumber('ADJ');
      const fullNotes = `${reasonLabel}${notes.trim() ? ' — ' + notes.trim() : ''}`;

      // 1. Quantity movement (only if there is a qty change)
      if (signedDelta !== 0) {
        const absQty = Math.abs(signedDelta);
        await base44.entities.StockMovement.create({
          product_id: product.id,
          product_sku: product.sku,
          product_name: product.name,
          qty: absQty,
          uom,
          reason: movementReason,
          ref_type: 'manual',
          ref_number: refNumber,
          unit_cost_at_movement: unitCostAtMovement,
          ...(signedDelta > 0
            ? { to_location_id: locationId }
            : { from_location_id: locationId }),
          notes: fullNotes,
        });

        // Pass newCostAvg only when adding stock and a value was supplied.
        const newCostAvg = signedDelta > 0 && newCost != null ? newCost : undefined;
        await adjustStockOnHand(product.id, locationId, signedDelta, newCostAvg);
      }

      // 2. Value-only / value-correction: update product cost_avg directly
      //    (when there is no stock-in to carry the new cost).
      if (newCost != null && !(signedDelta > 0)) {
        await base44.entities.Product.update(product.id, { cost_avg: newCost });
      }

      writeAuditLog({
        action: 'update',
        entity_type: 'StockMovement',
        entity_id: product.id,
        description: `Stock adjustment ${refNumber}: ${reasonLabel} — ${product.name}` +
          (signedDelta !== 0
            ? ` (${signedDelta > 0 ? '+' : ''}${signedDelta} ${uom} → ${resultingQty} ${uom})`
            : '') +
          (newCost != null ? ` cost ${formatZAR(newCost)}` : ''),
      });

      queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
      queryClient.invalidateQueries({ queryKey: ['stock-adjustments'] });

      toast.success(`Adjustment ${refNumber} posted — stock updated`);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
      setSaving(false);
      return;
    }
    setSaving(false);
    onCreated?.();
  };

  const uom = selectedProduct?.stock_uom || 'pcs';
  const directionLocked = selectedReason && selectedReason.direction !== 'both';

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">New Stock Adjustment</h3>
        <Button variant="ghost" size="icon" className="w-8 h-8" onClick={onCancel}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Product search */}
      <div>
        <label className="text-xs text-muted-foreground font-semibold">Product</label>
        {selectedProduct ? (
          <div className="flex items-center gap-3 mt-1 px-3 py-2 bg-muted/30 border border-border rounded-lg">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{selectedProduct.name}</p>
              <p className="text-xs text-muted-foreground font-mono">
                {selectedProduct.sku} · {uom} · Last cost: {formatZAR(lastCost)}/{uom}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedProduct(null)} className="text-xs">Change</Button>
          </div>
        ) : (
          <div className="relative mt-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by product code or name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
              autoFocus
            />
            {filteredProducts.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredProducts.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectProduct(p)}
                    className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border last:border-b-0"
                  >
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{p.sku} · {p.stock_uom}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Location */}
        <div>
          <label className="text-xs text-muted-foreground font-semibold">Location</label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Select location" /></SelectTrigger>
            <SelectContent>
              {locations.map(l => (
                <SelectItem key={l.id} value={l.id}>{l.name}{l.code ? ` (${l.code})` : ''}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Reason */}
        <div>
          <label className="text-xs text-muted-foreground font-semibold">Reason <span className="text-red-500">*</span></label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Select reason..." /></SelectTrigger>
            <SelectContent>
              {ADJUST_REASONS.map(r => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Current snapshot */}
      {selectedProduct && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/30 border border-border rounded-lg px-4 py-3">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Current On-Hand</p>
            <p className="text-xl font-bold mt-0.5 tabular-nums">{currentQty} <span className="text-sm font-normal text-muted-foreground">{uom}</span></p>
          </div>
          <div className="bg-muted/30 border border-border rounded-lg px-4 py-3">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Last Cost</p>
            <p className="text-xl font-bold mt-0.5 tabular-nums">{formatZAR(lastCost)}</p>
          </div>
        </div>
      )}

      {/* Quantity adjustment */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground font-semibold">Quantity Adjustment</label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setMode('delta')}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${mode === 'delta' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
            >
              +/- Change
            </button>
            <button
              type="button"
              onClick={() => setMode('target')}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${mode === 'target' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
            >
              Set Total
            </button>
          </div>
        </div>

        {mode === 'delta' ? (
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <button
                type="button"
                disabled={directionLocked}
                onClick={() => setDeltaSign('in')}
                className={`flex items-center gap-1 px-3 py-2 rounded-lg border text-sm font-medium transition-all disabled:opacity-50 ${deltaSign === 'in' ? 'border-green-500 bg-green-50 text-green-700' : 'border-border hover:bg-muted/30'}`}
              >
                <Plus className="w-4 h-4" /> Add
              </button>
              <button
                type="button"
                disabled={directionLocked}
                onClick={() => setDeltaSign('out')}
                className={`flex items-center gap-1 px-3 py-2 rounded-lg border text-sm font-medium transition-all disabled:opacity-50 ${deltaSign === 'out' ? 'border-red-500 bg-red-50 text-red-700' : 'border-border hover:bg-muted/30'}`}
              >
                <Minus className="w-4 h-4" /> Remove
              </button>
            </div>
            <Input
              type="number"
              min="0"
              step="any"
              value={deltaQty}
              onChange={e => setDeltaQty(e.target.value)}
              placeholder="0"
              className="flex-1 tabular-nums"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">{uom}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="0"
              step="any"
              value={targetQty}
              onChange={e => setTargetQty(e.target.value)}
              placeholder="New total on-hand"
              className="flex-1 tabular-nums"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">{uom}</span>
          </div>
        )}

        {selectedProduct && signedDelta !== 0 && (
          <p className={`text-xs tabular-nums ${signedDelta > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {signedDelta > 0 ? '+' : ''}{signedDelta} {uom} → resulting on-hand: <strong>{resultingQty} {uom}</strong>
            {resultingQty < 0 && <span className="text-red-600 font-semibold"> (negative!)</span>}
          </p>
        )}
      </div>

      {/* Value adjustment — gated by permission */}
      {canAdjustValue && (
        <div>
          <label className="text-xs text-muted-foreground font-semibold">
            Unit Cost {selectedReason?.value === 'value_correction' ? <span className="text-red-500">*</span> : '(optional)'}
          </label>
          <div className="flex items-center gap-2 mt-1">
            <Input
              type="number"
              min="0"
              step="any"
              value={unitCostInput}
              onChange={e => setUnitCostInput(e.target.value)}
              placeholder={lastCost ? String(lastCost) : '0.00'}
              className="flex-1 tabular-nums"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">/{uom}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {isValueOnly
              ? 'Value-only correction — updates the product average cost directly.'
              : 'Applied as the new average cost when adding stock; updates product cost otherwise.'}
          </p>
        </div>
      )}

      {/* Notes (mandatory) */}
      <div>
        <label className="text-xs text-muted-foreground font-semibold">Notes <span className="text-red-500">*</span></label>
        <Textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Explain this adjustment (required)..."
          className="mt-1 h-20"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button
          onClick={handleSave}
          disabled={saving || !selectedProduct || !locationId || !reason || !notes.trim()}
          className="gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Post Adjustment
        </Button>
      </div>
    </div>
  );
}
