import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, Gauge, MapPin, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import WarehouseZoneSelect from '@/components/shared/WarehouseZoneSelect';

/**
 * Bulk-edit inventory fields for the selected products.
 *   mode = 'reorder'  → per-item editable Reorder Point table (+ apply-to-all)
 *   mode = 'location' → assign one Default Location to all selected (metadata only)
 */
export default function InventoryBulkEditModal({ mode = 'reorder', products = [], locations = [], onCancel, onDone }) {
  const isReorder = mode === 'reorder';
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Reorder mode: per-product new value, keyed by id. Seed from current value.
  const [reorderValues, setReorderValues] = useState(() => {
    const m = {};
    products.forEach(p => { m[p.id] = String(p.min_before_reorder ?? 0); });
    return m;
  });
  const [applyAll, setApplyAll] = useState('');

  // Location mode
  const [locationId, setLocationId] = useState('');

  const setRowValue = (id, v) => setReorderValues(prev => ({ ...prev, [id]: v }));
  const applyToAll = () => {
    if (applyAll === '' || isNaN(Number(applyAll))) { toast.error('Enter a valid number to apply'); return; }
    setReorderValues(() => {
      const m = {};
      products.forEach(p => { m[p.id] = String(applyAll); });
      return m;
    });
  };

  const invalidReorder = useMemo(() => {
    if (!isReorder) return false;
    return products.some(p => {
      const v = reorderValues[p.id];
      return v === '' || isNaN(Number(v)) || Number(v) < 0;
    });
  }, [isReorder, products, reorderValues]);

  const changedReorder = useMemo(() => {
    if (!isReorder) return [];
    return products.filter(p => Number(reorderValues[p.id]) !== Number(p.min_before_reorder ?? 0));
  }, [isReorder, products, reorderValues]);

  const canSave = isReorder ? !invalidReorder && changedReorder.length > 0 : !!locationId;

  const doSave = async () => {
    setSaving(true);
    let ok = 0, fail = 0;
    if (isReorder) {
      for (const p of changedReorder) {
        try { await base44.entities.Product.update(p.id, { min_before_reorder: Number(reorderValues[p.id]) }); ok++; }
        catch { fail++; }
      }
    } else {
      for (const p of products) {
        try { await base44.entities.Product.update(p.id, { default_location_id: locationId }); ok++; }
        catch { fail++; }
      }
    }
    setSaving(false);
    if (fail) toast.error(`Updated ${ok}; ${fail} failed.`);
    else toast.success(`Updated ${ok} product${ok !== 1 ? 's' : ''}.`);
    onDone?.();
  };

  const handleSave = () => {
    if (!canSave) { toast.error(isReorder ? 'Enter valid reorder points (≥ 0)' : 'Select a location'); return; }
    const n = isReorder ? changedReorder.length : products.length;
    if (n >= 10) { setConfirming(true); return; }
    doSave();
  };

  const count = isReorder ? changedReorder.length : products.length;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-card rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="text-base font-bold flex items-center gap-2">
            {isReorder ? <Gauge className="w-4 h-4 text-primary" /> : <MapPin className="w-4 h-4 text-primary" />}
            {isReorder ? 'Update reorder point' : 'Set default location'} — {products.length} item{products.length !== 1 ? 's' : ''}
          </h2>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        {confirming ? (
          <div className="px-5 py-4 overflow-y-auto">
            <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="text-sm">
                You are about to update <strong>{count}</strong> product{count !== 1 ? 's' : ''}
                {isReorder ? ' reorder point.' : ` default location to ${locations.find(l => l.id === locationId)?.name || ''}.`}
              </div>
            </div>
          </div>
        ) : isReorder ? (
          <div className="px-5 py-3 overflow-y-auto">
            <div className="flex items-end gap-2 pb-3 border-b border-border">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Apply one value to all</label>
                <Input type="number" min="0" value={applyAll} onChange={e => setApplyAll(e.target.value)} className="h-9 w-32 mt-1" placeholder="e.g. 50" />
              </div>
              <Button variant="outline" size="sm" onClick={applyToAll} className="h-9">Apply to all</Button>
            </div>
            <table className="w-full mt-2">
              <thead>
                <tr className="text-left">
                  <th className="py-2 text-xs font-semibold text-muted-foreground uppercase">SKU</th>
                  <th className="py-2 text-xs font-semibold text-muted-foreground uppercase">Name</th>
                  <th className="py-2 text-xs font-semibold text-muted-foreground uppercase text-right">Current</th>
                  <th className="py-2 text-xs font-semibold text-muted-foreground uppercase text-right">New</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map(p => {
                  const v = reorderValues[p.id];
                  const bad = v === '' || isNaN(Number(v)) || Number(v) < 0;
                  return (
                    <tr key={p.id}>
                      <td className="py-2 text-sm font-mono">{p.sku}</td>
                      <td className="py-2 text-sm">{p.name}</td>
                      <td className="py-2 text-sm text-right tabular-nums text-muted-foreground">
                        {Number(p.min_before_reorder ?? 0).toLocaleString('en-ZA', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 text-right">
                        <Input
                          type="number"
                          min="0"
                          value={v}
                          onChange={e => setRowValue(p.id, e.target.value)}
                          className={`h-8 w-28 ml-auto text-right ${bad ? 'border-red-400' : ''}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-4 overflow-y-auto space-y-2">
            <p className="text-xs text-muted-foreground">
              Assign a default location to all {products.length} selected products. This updates the product's preferred location only — it does not move or create stock.
            </p>
            <label className="text-sm font-medium">Default Location</label>
            <WarehouseZoneSelect value={locationId} onChange={setLocationId} locations={locations} />
          </div>
        )}

        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">
            {isReorder ? `${changedReorder.length} change${changedReorder.length !== 1 ? 's' : ''} pending` : ''}
          </span>
          <div className="flex gap-2">
            {confirming ? (
              <>
                <Button variant="outline" onClick={() => setConfirming(false)} disabled={saving}>Back</Button>
                <Button onClick={doSave} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {saving ? 'Saving…' : `Confirm — update ${count}`}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving || !canSave} className="gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {saving ? 'Saving…' : `Save${count ? ` (${count})` : ''}`}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
