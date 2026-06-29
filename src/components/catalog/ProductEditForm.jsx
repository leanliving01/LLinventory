import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import UomSelect from '@/components/shared/UomSelect';
import ProductPurchaseUomEditor from '@/components/catalog/ProductPurchaseUomEditor';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Plus, Check, X as XIcon } from 'lucide-react';
import { useSubcategories } from '@/lib/useSubcategories';
import WarehouseZoneSelect from '@/components/shared/WarehouseZoneSelect';
import { defaultRolesForType, isSellable, isPurchasable } from '@/lib/productRoles';

// Compact "21 May 2026" formatter for the cost "last updated" badges.
const fmtCostDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

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

export default function ProductEditForm({ formData, onChange, locations, suppliers, productCategories = [], productId }) {
  const set = (field, value) => onChange({ ...formData, [field]: value });
  const queryClient = useQueryClient();
  const [showNewSub, setShowNewSub] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [savingSub, setSavingSub] = useState(false);

  // Classification = Category (product.type) + Subcategory (product.subcategory
  // text). Subcategory options come from Settings → Categories for the chosen
  // category, with the canonical defaults merged in.
  const { getSubcategoriesForType } = useSubcategories();
  const subcategoryOptions = formData.type ? getSubcategoriesForType(formData.type) : [];

  // Locally-managed tax rates + chart of accounts (replaces Xero source).
  const { data: taxRates = [] } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => base44.entities.TaxRate.filter({ active: true }, 'name', 50),
    staleTime: 300000,
  });
  const { data: accountingAccounts = [] } = useQuery({
    queryKey: ['accounting-accounts', 'all-active'],
    queryFn: () => base44.entities.AccountingAccount.filter({ is_active: true }, 'sort_order', 500),
    staleTime: 300000,
  });

  // Create a new subcategory: persist it to Settings → Categories (so it shows
  // everywhere) and select it on this product. Find-or-create the canonical
  // category row for the chosen category (its category_id is NOT NULL).
  const handleCreateSubcategory = async () => {
    const name = newSubName.trim();
    if (!name || !formData.type) return;
    setSavingSub(true);
    try {
      const dupe = subcategoryOptions.some(s => (s || '').toLowerCase() === name.toLowerCase());
      if (!dupe) {
        let cat = productCategories.find(c => c.product_type === formData.type);
        if (!cat) {
          cat = await base44.entities.ProductCategory.create({
            name: PRODUCT_TYPES.find(t => t.value === formData.type)?.label || formData.type,
            product_type: formData.type,
            is_active: true,
            sort_order: 999,
          });
          queryClient.invalidateQueries({ queryKey: ['product-categories'] });
        }
        await base44.entities.ProductSubcategory.create({
          name,
          category_id: cat.id,
          category_name: cat.name,
          product_type: formData.type,
          is_active: true,
          sort_order: 999,
        });
        queryClient.invalidateQueries({ queryKey: ['product-subcategories'] });
      }
      onChange({ ...formData, subcategory: name });
      setNewSubName('');
      setShowNewSub(false);
    } finally {
      setSavingSub(false);
    }
  };

  // Accounts split by type for each dropdown (sourced locally from Settings → Accounting).
  const cogsAccounts = accountingAccounts.filter(a => a.account_type === 'cogs');
  const inventoryAccounts = accountingAccounts.filter(a => a.account_type === 'inventory');
  const revenueAccounts = accountingAccounts.filter(a => a.account_type === 'revenue');
  // The value stored on the product is the account code (falling back to name).
  const acctValue = (a) => a.code || a.name;

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
          <FormField label="Category">
            <Select
              value={formData.type || ''}
              onValueChange={v => {
                // Changing category re-seeds the three role defaults for that
                // category (user can still override any toggle below) and
                // resets the subcategory. See src/lib/productRoles.js.
                const roles = defaultRolesForType(v);
                onChange({ ...formData, type: v, subcategory: '', ...roles });
              }}
            >
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {PRODUCT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Subcategory</Label>
              {formData.type && (
                <button
                  type="button"
                  onClick={() => { setShowNewSub(v => !v); setNewSubName(''); }}
                  className="text-xs text-primary hover:underline flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" /> New subcategory
                </button>
              )}
            </div>
            {showNewSub && formData.type && (
              <div className="flex gap-1.5 items-center">
                <Input
                  value={newSubName}
                  onChange={e => setNewSubName(e.target.value)}
                  placeholder="Subcategory name"
                  className="h-8 text-sm flex-1"
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateSubcategory(); if (e.key === 'Escape') setShowNewSub(false); }}
                  autoFocus
                />
                <button type="button" onClick={handleCreateSubcategory} disabled={savingSub || !newSubName.trim()}
                  className="h-8 w-8 flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => setShowNewSub(false)}
                  className="h-8 w-8 flex items-center justify-center rounded-md border border-border hover:bg-muted">
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <Select
              value={formData.subcategory || 'none'}
              onValueChange={v => set('subcategory', v === 'none' ? '' : v)}
            >
              <SelectTrigger><SelectValue placeholder={formData.type ? 'Select subcategory' : 'Select a category first'} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {subcategoryOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <FormField label="Weight" hint="Stored in grams; choose how you enter it">
            <div className="flex gap-1.5">
              <Input
                type="number"
                step="any"
                className="flex-1"
                value={(() => {
                  const g = formData.weight_g;
                  if (g == null || g === '') return '';
                  return (formData.weight_unit || 'g') === 'kg' ? g / 1000 : g;
                })()}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '') { set('weight_g', null); return; }
                  const num = Number(v);
                  const grams = (formData.weight_unit || 'g') === 'kg' ? num * 1000 : num;
                  set('weight_g', grams);
                }}
              />
              <Select
                value={formData.weight_unit || 'g'}
                onValueChange={v => set('weight_unit', v)}
              >
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="g">g</SelectItem>
                  <SelectItem value="kg">kg</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </FormField>
        </div>
        {/* Dimensions — optional */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Dimensions (cm) <span className="text-xs font-normal text-muted-foreground">— optional</span></Label>
          <div className="grid grid-cols-3 gap-3">
            <Input type="number" step="any" placeholder="Length" value={formData.length_cm ?? ''} onChange={e => set('length_cm', e.target.value ? Number(e.target.value) : null)} />
            <Input type="number" step="any" placeholder="Width" value={formData.width_cm ?? ''} onChange={e => set('width_cm', e.target.value ? Number(e.target.value) : null)} />
            <Input type="number" step="any" placeholder="Height" value={formData.height_cm ?? ''} onChange={e => set('height_cm', e.target.value ? Number(e.target.value) : null)} />
          </div>
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
      </Section>

      {/* ── Roles ── */}
      {/* Three independent roles drive what this product can do across the app.
          See src/lib/productRoles.js — they control the sales picker, PO picker,
          BOM eligibility, and which sections appear below. */}
      <Section title="Roles">
        <p className="text-xs text-muted-foreground -mt-1">
          What this product is for. A product needs at least one role; a sellable
          product must also be sourced (purchasable or produced in-house).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium">Sellable</p>
              <p className="text-xs text-muted-foreground">Sold to customers — appears on sales orders</p>
            </div>
            <Switch checked={formData.sellable === true} onCheckedChange={v => set('sellable', v)} />
          </div>
          <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium">Purchasable</p>
              <p className="text-xs text-muted-foreground">Bought from suppliers — appears on purchase orders</p>
            </div>
            <Switch checked={formData.purchasable !== false} onCheckedChange={v => set('purchasable', v)} />
          </div>
          <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium">Produced In-House</p>
              <p className="text-xs text-muted-foreground">Made during production — carries a recipe / BOM</p>
            </div>
            <Switch checked={formData.produced === true} onCheckedChange={v => set('produced', v)} />
          </div>
        </div>
        {formData.sellable === true && formData.purchasable === false && formData.produced !== true && (
          <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
            This product is sellable but has no source — mark it purchasable or produced in-house so it can actually be supplied.
          </div>
        )}
        {formData.sellable !== true && formData.purchasable === false && formData.produced !== true && (
          <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
            This product has no role — it won't appear on sales orders, purchase orders, or in production.
          </div>
        )}
        {formData.produced === true && (
          <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-2.5 text-sm text-blue-700 dark:text-blue-300">
            Produced in-house — manage its recipe / BOM from the Recipes tab.
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
        {/* Selling price + margin only apply to sellable products. */}
        {isSellable(formData) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Selling price — editable */}
            <FormField label="Selling Price (excl. VAT, ZAR)" hint="Set by ops manager — authoritative for margin calc">
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
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Current cost — read-only */}
          <FormField label="Current Cost (excl. VAT, ZAR)" hint="Last GRN receipt price — auto-updated">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-9 px-3 flex items-center rounded-md border border-border bg-muted/40 text-sm text-muted-foreground font-mono">
                {formData.cost_current != null ? Number(formData.cost_current).toFixed(4) : '—'}
              </div>
              {fmtCostDate(formData.cost_current_updated_at) ? (
                <span
                  className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded whitespace-nowrap"
                  title="When the current cost was last updated"
                >
                  {fmtCostDate(formData.cost_current_updated_at)}
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">AUTO</span>
              )}
            </div>
          </FormField>
          {/* Weighted avg cost — read-only */}
          <FormField label="Weighted Avg Cost (excl. VAT, ZAR)" hint="Running weighted average — auto-updated on receipt">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-9 px-3 flex items-center rounded-md border border-border bg-muted/40 text-sm text-muted-foreground font-mono">
                {formData.cost_avg != null ? Number(formData.cost_avg).toFixed(4) : '—'}
              </div>
              {fmtCostDate(formData.cost_avg_updated_at) ? (
                <span
                  className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded whitespace-nowrap"
                  title="When the weighted-average cost was last updated"
                >
                  {fmtCostDate(formData.cost_avg_updated_at)}
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">AUTO</span>
              )}
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
        <p className="text-xs text-muted-foreground">Where this product is stored — pick the warehouse, then optionally a specific zone.</p>
        <WarehouseZoneSelect
          value={formData.default_location_id || ''}
          onChange={(id) => set('default_location_id', id)}
          locations={locations}
        />
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

      {/* ── Accounting ── */}
      <Section title="Accounting">
        <p className="text-xs text-muted-foreground">Tax rules and accounts are managed in Settings → Accounting.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="COGS Account" hint="Cost of Goods Sold account">
            <Select value={formData.cogs_account || 'none'} onValueChange={v => set('cogs_account', v === 'none' ? '' : v)}>
              <SelectTrigger className="font-mono"><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {cogsAccounts.map(a => (
                  <SelectItem key={a.id} value={acctValue(a)}>{a.code ? `${a.code} — ` : ''}{a.name}</SelectItem>
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
                  <SelectItem key={a.id} value={acctValue(a)}>{a.code ? `${a.code} — ` : ''}{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {/* Revenue account only applies to sellable products. */}
          {isSellable(formData) && (
            <FormField label="Revenue Account" hint="For sellable products">
              <Select value={formData.revenue_account || 'none'} onValueChange={v => set('revenue_account', v === 'none' ? '' : v)}>
                <SelectTrigger className="font-mono"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {revenueAccounts.map(a => (
                    <SelectItem key={a.id} value={acctValue(a)}>{a.code ? `${a.code} — ` : ''}{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Purchase tax only applies to purchasable products. */}
          {isPurchasable(formData) && (
          <FormField label="Purchase Tax Rule" hint="Tax rule for purchases">
            <Select value={formData.purchase_tax_rule || 'none'} onValueChange={v => set('purchase_tax_rule', v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select tax rule" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {taxRates.map(t => (
                  <SelectItem key={t.id} value={t.name}>{t.name}{t.rate != null ? ` (${(t.rate * 100).toFixed(2)}%)` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          )}
          {/* Sale tax only applies to sellable products. */}
          {isSellable(formData) && (
          <FormField label="Sale Tax Rule" hint="Tax rule for sales (sellable items)">
            <Select value={formData.sale_tax_rule || 'none'} onValueChange={v => set('sale_tax_rule', v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select tax rule" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {taxRates.map(t => (
                  <SelectItem key={t.id + '-sale'} value={t.name}>{t.name}{t.rate != null ? ` (${(t.rate * 100).toFixed(2)}%)` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          )}
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