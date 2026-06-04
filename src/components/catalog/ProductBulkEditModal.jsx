import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, Pencil, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  getSubcategoriesForCategory,
} from '@/lib/productClassification';

const UOM_OPTIONS = ['g', 'kg', 'ml', 'L', 'pcs', 'box'];

/**
 * Bulk-edit shared fields across the selected products. Only fields whose
 * "Apply" toggle is on are written; everything else is left untouched.
 */
export default function ProductBulkEditModal({ productIds = [], products = [], locations = [], onCancel, onDone }) {
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [apply, setApply] = useState({
    type: false,
    subcategory: false,
    default_location_id: false,
    stock_uom: false,
    sellable: false,
    purchasable: false,
    inventory_tracked: false,
  });

  // Values
  const [type, setType] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [locationId, setLocationId] = useState('');
  const [uom, setUom] = useState('');
  const [sellable, setSellable] = useState(true);
  const [purchasable, setPurchasable] = useState(true);
  const [inventoryTracked, setInventoryTracked] = useState(true);

  const toggleApply = (key) => setApply(prev => ({ ...prev, [key]: !prev[key] }));

  // Determine the effective category for the subcategory dropdown.
  const selectedTypes = useMemo(() => [...new Set(products.map(p => p.type))], [products]);
  const multipleCategories = selectedTypes.length > 1;
  // The category that constrains subcategory options: the chosen new category
  // (if applying one) else the single shared category of the selection.
  const effectiveCategory = apply.type ? type : (multipleCategories ? '' : selectedTypes[0]);
  const subcategoryOptions = effectiveCategory ? getSubcategoriesForCategory(effectiveCategory) : [];
  const subcategoryDisabled = !effectiveCategory;

  const categoryChanged = apply.type && type && selectedTypes.some(t => t !== type);

  const buildPayload = () => {
    const payload = {};
    if (apply.type && type) {
      payload.type = type;
      // Changing category clears the stored subcategory so it re-detects,
      // unless the user is also setting a subcategory explicitly.
      if (!apply.subcategory) payload.subcategory = '';
    }
    if (apply.subcategory && subcategory) payload.subcategory = subcategory;
    if (apply.default_location_id) payload.default_location_id = locationId || null;
    if (apply.stock_uom && uom) payload.stock_uom = uom;
    if (apply.sellable) payload.sellable = sellable;
    if (apply.purchasable) payload.purchasable = purchasable;
    if (apply.inventory_tracked) payload.inventory_tracked = inventoryTracked;
    return payload;
  };

  const appliedKeys = Object.keys(apply).filter(k => apply[k]);
  const canSave = appliedKeys.length > 0 &&
    !(apply.subcategory && subcategoryDisabled) &&
    !(apply.subcategory && !subcategory) &&
    !(apply.type && !type) &&
    !(apply.stock_uom && !uom);

  const doSave = async () => {
    const payload = buildPayload();
    if (Object.keys(payload).length === 0) { toast.error('Tick at least one field to apply'); return; }
    setSaving(true);
    let ok = 0, fail = 0;
    for (const id of productIds) {
      try { await base44.entities.Product.update(id, payload); ok++; }
      catch { fail++; }
    }
    setSaving(false);
    if (fail) toast.error(`Updated ${ok}; ${fail} failed.`);
    else toast.success(`Updated ${ok} product${ok !== 1 ? 's' : ''}.`);
    onDone?.();
  };

  const handleSave = () => {
    if (!canSave) { toast.error('Resolve the highlighted fields first'); return; }
    // Confirmation summary for large batches or category changes
    if (productIds.length >= 10 || categoryChanged) {
      setConfirming(true);
      return;
    }
    doSave();
  };

  const Row = ({ field, label, children }) => (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <label className="flex items-center gap-2 w-44 shrink-0 pt-1 cursor-pointer">
        <input type="checkbox" className="rounded w-4 h-4" checked={apply[field]} onChange={() => toggleApply(field)} />
        <span className="text-sm font-medium">{label}</span>
      </label>
      <div className={`flex-1 ${apply[field] ? '' : 'opacity-40 pointer-events-none'}`}>{children}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-card rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary" /> Bulk edit {productIds.length} product{productIds.length !== 1 ? 's' : ''}
          </h2>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        {confirming ? (
          <div className="px-5 py-4 overflow-y-auto space-y-3">
            <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="text-sm">
                You are about to update <strong>{productIds.length}</strong> products.
                {categoryChanged && <div className="mt-1">This changes the <strong>Category</strong> — it affects grouping, filters and may impact recipes, production and Shopify sync.</div>}
              </div>
            </div>
            <div className="text-sm">
              <p className="font-medium mb-1">Fields to apply:</p>
              <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">
                {apply.type && <li>Category → {CATEGORY_LABELS[type]}</li>}
                {apply.subcategory && <li>Subcategory → {subcategory}</li>}
                {apply.default_location_id && <li>Default Location → {locations.find(l => l.id === locationId)?.name || 'None'}</li>}
                {apply.stock_uom && <li>UOM → {uom}</li>}
                {apply.sellable && <li>Sellable → {sellable ? 'Yes' : 'No'}</li>}
                {apply.purchasable && <li>Purchasable → {purchasable ? 'Yes' : 'No'}</li>}
                {apply.inventory_tracked && <li>Inventory tracked → {inventoryTracked ? 'Yes' : 'No'}</li>}
              </ul>
            </div>
          </div>
        ) : (
          <div className="px-5 py-2 overflow-y-auto">
            <p className="text-xs text-muted-foreground py-2">Tick a field to apply it to all selected products. Unticked fields are left unchanged.</p>

            <Row field="type" label="Category">
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_ORDER.map(t => <SelectItem key={t} value={t}>{CATEGORY_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Row>

            <Row field="subcategory" label="Subcategory">
              {subcategoryDisabled ? (
                <p className="text-xs text-amber-600 pt-2">
                  Selection spans multiple categories. Tick &amp; choose a shared Category above to set a subcategory.
                </p>
              ) : (
                <Select value={subcategory} onValueChange={setSubcategory}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select subcategory" /></SelectTrigger>
                  <SelectContent>
                    {subcategoryOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </Row>

            <Row field="default_location_id" label="Default Location">
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Row>

            <Row field="stock_uom" label="UOM">
              <Select value={uom} onValueChange={setUom}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select UOM" /></SelectTrigger>
                <SelectContent>
                  {UOM_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </Row>

            <Row field="sellable" label="Sellable">
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={sellable} onCheckedChange={setSellable} />
                <span className="text-sm text-muted-foreground">{sellable ? 'Yes' : 'No'}</span>
              </div>
            </Row>

            <Row field="purchasable" label="Purchasable">
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={purchasable} onCheckedChange={setPurchasable} />
                <span className="text-sm text-muted-foreground">{purchasable ? 'Yes' : 'No'}</span>
              </div>
            </Row>

            <Row field="inventory_tracked" label="Inventory tracked">
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={inventoryTracked} onCheckedChange={setInventoryTracked} />
                <span className="text-sm text-muted-foreground">{inventoryTracked ? 'Yes' : 'No'}</span>
              </div>
            </Row>
          </div>
        )}

        <div className="px-5 py-3 border-t border-border flex justify-end gap-2 shrink-0">
          {confirming ? (
            <>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={saving}>Back</Button>
              <Button onClick={doSave} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {saving ? 'Saving…' : `Confirm — update ${productIds.length}`}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !canSave} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {saving ? 'Saving…' : `Apply to ${productIds.length}`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
