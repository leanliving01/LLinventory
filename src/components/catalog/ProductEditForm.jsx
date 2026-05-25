import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import UomSelect from '@/components/shared/UomSelect';
import useXeroChartData from '@/lib/useXeroChartData';
import ProductPurchaseUomEditor from '@/components/catalog/ProductPurchaseUomEditor';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Plus, Check, X as XIcon } from 'lucide-react';

const PRODUCT_TYPES = [
  { value: 'raw', label: 'Raw Material' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'wip_bulk', label: 'Bulk Cooked' },
  { value: 'finished_meal', label: 'Finished Meal' },
  { value: 'supplement', label: 'Supplement' },
  { value: 'package', label: 'Package' },
  { value: 'sauce', label: 'Sauce' },
  { value: 'solo_serve', label: 'Solo Serve' },
  { value: 'bundle', label: 'Bundle' },
  { value: 'service', label: 'Service' },
];

const PICK_CATEGORIES = [
  'Meats', 'Vegetables', 'Starches', 'Spices & Seasoning',
  'Sauces & Condiments', 'Dairy & Eggs', 'Oils & Fats',
  'Dry Goods', 'Packaging', 'Other',
];

function Section({ title, children }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

function FormField({ label, children, hint }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function ProductEditForm({ formData, onChange, locations, suppliers, categories = [], productCategories = [], productSubcategories = [], productId }) {
  const set = (field, value) => onChange({ ...formData, [field]: value });
  const { accounts: xeroAccounts, taxRates: xeroTaxRates, isLoading: xeroLoading } = useXeroChartData();
  const queryClient = useQueryClient();
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [savingCat, setSavingCat] = useState(false);

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) return;
    setSavingCat(true);
    const created = await base44.entities.ProductCategory.create({
      name: newCatName.trim(),
      product_type: formData.type || 'raw',
      is_active: true,
      sort_order: 999,
    });
    queryClient.invalidateQueries({ queryKey: ['product-categories'] });
    onChange({ ...formData, category_id: created.id, subcategory_id: '' });
    setNewCatName('');
    setShowNewCat(false);
    setSavingCat(false);
  };

  // Filter accounts by class for each dropdown
  const cogsAccounts = xeroAccounts.filter(a => a.class === 'EXPENSE' || a.type === 'DIRECTCOSTS');
  const inventoryAccounts = xeroAccounts.filter(a => a.type === 'INVENTORY' || a.type === 'CURRLIAB' || a.type === 'CURRENT' || a.class === 'ASSET');
  const revenueAccounts = xeroAccounts.filter(a => a.class === 'REVENUE');

  return (
    <div className="space-y-5">
      {/* ── Core Info ── */}
      <Section title="Core Information">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Product Name">
            <Input value={formData.name || ''} onChange={e => set('name', e.target.value)} />
          </FormField>
          <FormField label="SKU">
            <Input value={formData.sku || ''} onChange={e => set('sku', e.target.value)} className="font-mono" />
          </FormField>
          <FormField label="Barcode">
            <Input value={formData.barcode || ''} onChange={e => set('barcode', e.target.value)} />
          </FormField>
          <FormField label="Type">
            <Select value={formData.type || ''} onValueChange={v => set('type', v)}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {PRODUCT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Category</Label>
              <button
                type="button"
                onClick={() => { setShowNewCat(v => !v); setNewCatName(''); }}
                className="text-xs text-primary hover:underline flex items-center gap-0.5"
              >
                <Plus className="w-3 h-3" /> New category
              </button>
            </div>
            {showNewCat && (
              <div className="flex gap-1.5 items-center">
                <Input
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  placeholder={`Category name (${formData.type || 'raw'})`}
                  className="h-8 text-sm flex-1"
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateCategory(); if (e.key === 'Escape') setShowNewCat(false); }}
                  autoFocus
                />
                <button type="button" onClick={handleCreateCategory} disabled={savingCat || !newCatName.trim()}
                  className="h-8 w-8 flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => setShowNewCat(false)}
                  className="h-8 w-8 flex items-center justify-center rounded-md border border-border hover:bg-muted">
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <Select
              value={formData.category_id || 'none'}
              onValueChange={v => {
                const newCatId = v === 'none' ? '' : v;
                onChange({ ...formData, category_id: newCatId, subcategory_id: '' });
              }}
            >
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {productCategories
                  .filter(c => !formData.type || c.product_type === formData.type)
                  .map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {formData.category && !formData.category_id && (
              <p className="text-[10px] text-amber-600">Legacy: {formData.category}</p>
            )}
          </div>
          <FormField label="Subcategory">
            <Select
              value={formData.subcategory_id || 'none'}
              onValueChange={v => set('subcategory_id', v === 'none' ? '' : v)}
            >
              <SelectTrigger><SelectValue placeholder="Select subcategory" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {productSubcategories
                  .filter(s => formData.category_id && s.category_id === formData.category_id)
                  .map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {formData.subcategory && !formData.subcategory_id && (
              <p className="text-[10px] text-amber-600">Legacy: {formData.subcategory}</p>
            )}
          </FormField>
          <FormField label="Weight (grams)">
            <Input type="number" value={formData.weight_g || ''} onChange={e => set('weight_g', e.target.value ? Number(e.target.value) : null)} />
          </FormField>
        </div>
        <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
          <div>
            <p className="text-sm font-medium">Active</p>
            <p className="text-xs text-muted-foreground">Inactive products are hidden from production and ordering</p>
          </div>
          <Switch checked={(formData.status || 'active') === 'active'} onCheckedChange={v => set('status', v ? 'active' : 'archived')} />
        </div>
        <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
          <div>
            <p className="text-sm font-medium">Track Inventory</p>
            <p className="text-xs text-muted-foreground">Commits and deducts stock from Shopify orders</p>
          </div>
          <Switch checked={formData.inventory_tracked !== false} onCheckedChange={v => set('inventory_tracked', v)} />
        </div>
        <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
          <div>
            <p className="text-sm font-medium">Sellable</p>
            <p className="text-xs text-muted-foreground">Sold to customers (meals, supplements, packages)</p>
          </div>
          <Switch checked={formData.sellable === true} onCheckedChange={v => set('sellable', v)} />
        </div>
      </Section>

      {/* ── Supply Method ── */}
      <Section title="Supply Method">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium">Purchasable</p>
              <p className="text-xs text-muted-foreground">Bought from suppliers (raw materials, packaging)</p>
            </div>
            <Switch checked={formData.purchasable !== false} onCheckedChange={v => set('purchasable', v)} />
          </div>
          <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium">Produced In-House</p>
              <p className="text-xs text-muted-foreground">Made during production (bulk cooked, finished meals)</p>
            </div>
            <Switch checked={!formData.purchasable || ['wip_bulk', 'finished_meal', 'sauce', 'solo_serve'].includes(formData.type)} disabled />
          </div>
        </div>
        {formData.purchasable === false && (
          <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-2.5 text-sm text-blue-700 dark:text-blue-300">
            This product is produced in-house — supplier, purchase UoM, and purchasing sections are hidden.
          </div>
        )}
      </Section>

      {/* ── Units of Measure ── */}
      <Section title="Units of Measure">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Stock UoM" hint="Internal tracking unit (kg, g, pcs, L, ml, box)">
            <UomSelect value={formData.stock_uom || ''} onValueChange={v => set('stock_uom', v)} placeholder="Select unit" />
          </FormField>
          <FormField label="Recipe UoM" hint="Unit used in BOMs (e.g. g when stock UoM is kg)">
            <Input value={formData.recipe_uom || ''} onChange={e => set('recipe_uom', e.target.value)} />
          </FormField>
        </div>
        {/* Purchase UoM is managed in the Purchasing Units section below — not here */}

        {/* Multiple purchase UoMs */}
        {productId && formData.purchasable !== false && (
          <ProductPurchaseUomEditor
            productId={productId}
            stockUom={formData.stock_uom}
            suppliers={suppliers}
          />
        )}
      </Section>

      {/* ── Pricing & Costing ── */}
      <Section title="Pricing & Costing">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Selling price — editable */}
          <FormField label="Selling Price (ZAR)" hint="Set by ops manager — authoritative for margin calc">
            <Input type="number" step="0.01" value={formData.selling_price ?? formData.price ?? ''} onChange={e => set('selling_price', e.target.value ? Number(e.target.value) : 0)} />
          </FormField>
          {/* Gross margin — computed, read-only */}
          {(() => {
            const sp = formData.selling_price || formData.price || 0;
            const ca = formData.cost_avg || 0;
            const margin = sp > 0 && ca > 0 ? ((sp - ca) / sp * 100).toFixed(1) : null;
            return margin ? (
              <FormField label="Gross Margin %">
                <div className={`flex items-center h-9 px-3 rounded-md border text-sm font-medium ${parseFloat(margin) >= 50 ? 'bg-green-50 border-green-200 text-green-700' : parseFloat(margin) >= 40 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                  {margin}%
                </div>
              </FormField>
            ) : null;
          })()}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Current cost — read-only */}
          <FormField label="Current Cost (ZAR)" hint="Last GRN receipt price — auto-updated">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-9 px-3 flex items-center rounded-md border border-border bg-muted/40 text-sm text-muted-foreground font-mono">
                {formData.cost_current != null ? Number(formData.cost_current).toFixed(4) : '—'}
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">AUTO</span>
            </div>
          </FormField>
          {/* Weighted avg cost — read-only */}
          <FormField label="Weighted Avg Cost (ZAR)" hint="Running weighted average — auto-updated on receipt">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-9 px-3 flex items-center rounded-md border border-border bg-muted/40 text-sm text-muted-foreground font-mono">
                {formData.cost_avg != null ? Number(formData.cost_avg).toFixed(4) : '—'}
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">AUTO</span>
            </div>
          </FormField>
        </div>
        {/* Costing method */}
        <FormField label="Costing Method" hint="FIFO: oldest purchase price consumed first. Weighted Average: blended cost across all stock.">
          <Select value={formData.costing_method || 'fifo'} onValueChange={v => set('costing_method', v)}>
            <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fifo">FIFO — First In, First Out</SelectItem>
              <SelectItem value="weighted_average">Weighted Average</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      </Section>

      {/* ── Planning ── */}
      <Section title="Planning & Reorder">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Par Level" hint="Target on-hand quantity">
            <Input type="number" value={formData.par_level ?? ''} onChange={e => set('par_level', e.target.value ? Number(e.target.value) : 0)} />
          </FormField>
          <FormField label="Reorder Point" hint="Minimum before reorder">
            <Input type="number" value={formData.min_before_reorder ?? ''} onChange={e => set('min_before_reorder', e.target.value ? Number(e.target.value) : 0)} />
          </FormField>
          <FormField label="Reorder Qty">
            <Input type="number" value={formData.reorder_qty ?? ''} onChange={e => set('reorder_qty', e.target.value ? Number(e.target.value) : 0)} />
          </FormField>
        </div>
        <FormField label="Lead Time (days)">
          <Input type="number" value={formData.lead_time_days ?? ''} onChange={e => set('lead_time_days', e.target.value ? Number(e.target.value) : 0)} className="max-w-xs" />
        </FormField>
      </Section>

      {/* Supplier relationships are managed in the "Purchasing Units" section below and in the Suppliers tab.
          The legacy supplier_id / supplier_sku fields have been removed from the form. */}

      {/* ── Location ── */}
      <Section title="Default Location">
        <FormField label="Default Storage Location">
          <Select value={formData.default_location_id || 'none'} onValueChange={v => set('default_location_id', v === 'none' ? '' : v)}>
            <SelectTrigger className="max-w-sm"><SelectValue placeholder="Select location" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— None —</SelectItem>
              {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>
      </Section>

      {/* ── Operational ── */}
      <Section title="Operational">
        <FormField label="Pick Category" hint="Groups this product on kitchen pick lists (raw materials only)">
          <Select value={formData.pick_category || 'none'} onValueChange={v => set('pick_category', v === 'none' ? '' : v)}>
            <SelectTrigger className="max-w-xs"><SelectValue placeholder="Select pick category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— None —</SelectItem>
              {PICK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>
      </Section>

      {/* ── Shopify / External ── */}
      <Section title="Shopify & External IDs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Shopify Product ID">
            <Input value={formData.shopify_product_id || ''} onChange={e => set('shopify_product_id', e.target.value)} className="font-mono text-xs" />
          </FormField>
          <FormField label="Shopify Variant ID">
            <Input value={formData.shopify_variant_id || ''} onChange={e => set('shopify_variant_id', e.target.value)} className="font-mono text-xs" />
          </FormField>
          <FormField label="External ID">
            <Input value={formData.external_id || ''} onChange={e => set('external_id', e.target.value)} className="font-mono text-xs" />
          </FormField>
        </div>
      </Section>

      {/* ── Accounting / Xero ── */}
      <Section title="Accounting (Xero)">
        {xeroLoading && <p className="text-xs text-muted-foreground">Loading Xero accounts…</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="COGS Account" hint="Cost of Goods Sold account">
            <Select value={formData.cogs_account || 'none'} onValueChange={v => set('cogs_account', v === 'none' ? '' : v)}>
              <SelectTrigger className="font-mono"><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {cogsAccounts.map(a => (
                  <SelectItem key={a.code} value={a.code}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Inventory Account" hint="Inventory Asset account">
            <Select value={formData.inventory_account || 'none'} onValueChange={v => set('inventory_account', v === 'none' ? '' : v)}>
              <SelectTrigger className="font-mono"><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {inventoryAccounts.map(a => (
                  <SelectItem key={a.code} value={a.code}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Revenue Account" hint="For sellable products">
            <Select value={formData.revenue_account || 'none'} onValueChange={v => set('revenue_account', v === 'none' ? '' : v)}>
              <SelectTrigger className="font-mono"><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {revenueAccounts.map(a => (
                  <SelectItem key={a.code} value={a.code}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Purchase Tax Rule" hint="Tax rule for purchases">
            <Select value={formData.purchase_tax_rule || 'none'} onValueChange={v => set('purchase_tax_rule', v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select tax rule" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {xeroTaxRates.map(t => (
                  <SelectItem key={t.taxType} value={t.name}>{t.name}{t.rate != null ? ` (${t.rate}%)` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Sale Tax Rule" hint="Tax rule for sales (sellable items)">
            <Select value={formData.sale_tax_rule || 'none'} onValueChange={v => set('sale_tax_rule', v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select tax rule" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {xeroTaxRates.map(t => (
                  <SelectItem key={t.taxType + '-sale'} value={t.name}>{t.name}{t.rate != null ? ` (${t.rate}%)` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
      </Section>

      {/* ── Notes ── */}
      <Section title="Notes">
        <FormField label="Description">
          <Textarea value={formData.description || ''} onChange={e => set('description', e.target.value)} rows={3} />
        </FormField>
        <FormField label="Internal Notes">
          <Textarea value={formData.internal_note || ''} onChange={e => set('internal_note', e.target.value)} rows={3} />
        </FormField>
      </Section>
    </div>
  );
}