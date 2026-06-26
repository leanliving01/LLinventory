import React, { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PurchaseUnitSelect from '@/components/shared/PurchaseUnitSelect';
import { MEASURE_UNITS, computeConversion } from '@/lib/purchasingUnit';

/**
 * The shared purchasing-unit capture block, used by the product editor and the
 * Review Queue. It owns: Purchase UOM (name) + Pack size + Packs-per-unit, and
 * AUTO-derives the conversion factor (1 purchase unit = X stock units), shown as
 * plain working. A small "override" reveals a manual box for odd cases (e.g. the
 * pack unit's family doesn't match the stock unit).
 *
 * Reads/writes a flat `form` via `set(key, value)`:
 *   purchase_uom, pack_size, pack_size_uom, pack_qty, conversion_factor
 */
export default function PurchasingUnitFields({ form, set, stockUom }) {
  const su = stockUom || 'stock';
  const [override, setOverride] = useState(false);

  // Default the pack unit to the product's stock unit the first time.
  useEffect(() => {
    if (!form.pack_size_uom) {
      const match = MEASURE_UNITS.find(u => u.code === String(stockUom || '').toLowerCase());
      set('pack_size_uom', match ? match.code : 'kg');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const auto = useMemo(() => computeConversion({
    packSize: form.pack_size, packSizeUom: form.pack_size_uom,
    packQty: form.pack_qty, stockUom,
  }), [form.pack_size, form.pack_size_uom, form.pack_qty, stockUom]);

  const showManual = override || !auto;

  // Push the auto-derived factor up whenever it changes (unless overriding).
  useEffect(() => {
    if (!override && auto && String(auto.value) !== String(form.conversion_factor)) {
      set('conversion_factor', String(auto.value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, override]);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Purchase UOM *</Label>
        <PurchaseUnitSelect value={form.purchase_uom} onValueChange={v => set('purchase_uom', v)} />
        <p className="text-[11px] text-muted-foreground">How you order it — a Case, Bag, Pocket, or just kg.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Pack size *</Label>
          <div className="flex gap-1.5">
            <Input
              type="number" step="any" placeholder="e.g. 500"
              value={form.pack_size ?? ''}
              onChange={e => set('pack_size', e.target.value)}
              className="flex-1"
            />
            <Select value={String(form.pack_size_uom || '').toLowerCase() || 'kg'} onValueChange={v => set('pack_size_uom', v)}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MEASURE_UNITS.map(u => <SelectItem key={u.code} value={u.code}>{u.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground">Size of one item/packet.</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Packs per purchase unit</Label>
          <Input
            type="number" step="any" placeholder="1"
            value={form.pack_qty ?? ''}
            onChange={e => set('pack_qty', e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">e.g. 24 per case. Leave 1 for a single bag.</p>
        </div>
      </div>

      {/* Auto conversion */}
      {!showManual ? (
        <div className="px-3 py-2 bg-background rounded-md border border-border text-sm flex items-center justify-between gap-2 flex-wrap">
          <span>
            <span className="text-muted-foreground">Conversion: </span>
            <span className="font-medium">{auto.working}</span>
          </span>
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setOverride(true)}>
            override
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-xs">Conversion Factor * (1 {form.purchase_uom || 'purchase unit'} = X {su})</Label>
          <Input
            type="number" step="any" placeholder={`e.g. 12`}
            value={form.conversion_factor ?? ''}
            onChange={e => set('conversion_factor', e.target.value)}
          />
          {!auto && (form.pack_size || form.pack_size_uom) && (
            <p className="text-[11px] text-amber-600">
              Can't auto-convert {form.pack_size_uom || 'this unit'} → {su}. Enter the factor manually.
            </p>
          )}
          {override && auto && (
            <button type="button" className="text-[11px] text-primary hover:underline"
              onClick={() => setOverride(false)}>
              use auto ({auto.value})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
