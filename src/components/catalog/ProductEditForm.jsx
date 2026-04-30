import React from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import UomSelect from '@/components/shared/UomSelect';
import useXeroChartData from '@/lib/useXeroChartData';
import ProductPurchaseUomEditor from '@/components/catalog/ProductPurchaseUomEditor';

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

export default function ProductEditForm({ formData, onChange, locations, suppliers, categories = [], productId }) {
  const set = (field, value) => onChange({ ...formData, [field]: value });
  const { accounts: xeroAccounts, taxRates: xeroTaxRates, isLoading: xeroLoading } = useXeroChartData();

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
          <FormField label="Category">
            <Select value={formData.category || 'none'} onValueChange={v => set('category', v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Pick Category">
            <Select value={formData.pick_category || ''} onValueChange={v => set('pick_category', v)}>
              <SelectTrigger><SelectValue placeholder="Select pick category" /></SelectTrigger>
              <SelectContent>
                {PICK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium">Sellable</p>
              <p className="text-xs text-muted-foreground">Sold to customers (meals, supplements, packages)</p>
            </div>
            <Switch checked={formData.sellable === true} onCheckedChange={v => set('sellable', v)} />
          </div>
          <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium">Purchasable</p>
              <p className="text-xs text-muted-foreground">Bought from suppliers (raw materials, packaging)</p>
            </div>
            <Switch checked={formData.purchasable !== false} onCheckedChange={v => set('purchasable', v)} />
          </div>
        </div>
      </Section>

      {/* ── Units of Measure ── */}
      <Section title="Units of Measure">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Stock UoM" hint="Unit used in inventory">
            <UomSelect value={formData.stock_uom || ''} onValueChange={v => set('stock_uom', v)} placeholder="Select unit" />
          </FormField>
          <FormField label="Purchase UoM" hint="e.g. Box of 10kg">
            <Input value={formData.purchase_uom || ''} onChange={e => set('purchase_uom', e.target.value)} />
          </FormField>
          <FormField label="Purchase → Stock Factor" hint="e.g. 10 if 1 Box = 10 kg">
            <Input type="number" value={formData.purchase_to_stock_factor || ''} onChange={e => set('purchase_to_stock_factor', e.target.value ? Number(e.target.value) : null)} />
          </FormField>
        </div>
        <FormField label="Recipe UoM" hint="Unit used in recipes (e.g. g when stock is kg)">
          <Input value={formData.recipe_uom || ''} onChange={e => set('recipe_uom', e.target.value)} className="max-w-xs" />
        </FormField>

        {/* Multiple purchase UoMs */}
        {productId && (
          <ProductPurchaseUomEditor
            productId={productId}
            stockUom={formData.stock_uom}
            suppliers={suppliers}
          />
        )}
      </Section>

      {/* ── Pricing ── */}
      <Section title="Pricing (ZAR)">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Weighted Avg Cost" hint="Updated on each PO receipt">
            <Input type="number" step="0.01" value={formData.cost_avg ?? ''} onChange={e => set('cost_avg', e.target.value ? Number(e.target.value) : 0)} />
          </FormField>
          <FormField label="Current Cost" hint="Latest supplier price for new stock">
            <Input type="number" step="0.01" value={formData.cost_current ?? ''} onChange={e => set('cost_current', e.target.value ? Number(e.target.value) : 0)} />
          </FormField>
          <FormField label="Selling Price" hint="Shopify authoritative — local override">
            <Input type="number" step="0.01" value={formData.price ?? ''} onChange={e => set('price', e.target.value ? Number(e.target.value) : 0)} />
          </FormField>
        </div>
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

      {/* ── Supplier ── */}
      <Section title="Supplier">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Supplier">
            <Select value={formData.supplier_id || 'none'} onValueChange={v => set('supplier_id', v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Supplier SKU">
            <Input value={formData.supplier_sku || ''} onChange={e => set('supplier_sku', e.target.value)} />
          </FormField>
        </div>
      </Section>

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

      {/* ── Shopify / External ── */}
      <Section title="Shopify & External IDs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Shopify Product ID">
            <Input value={formData.shopify_product_id || ''} onChange={e => set('shopify_product_id', e.target.value)} className="font-mono text-xs" />
          </FormField>
          <FormField label="Shopify Variant ID">
            <Input value={formData.shopify_variant_id || ''} onChange={e => set('shopify_variant_id', e.target.value)} className="font-mono text-xs" />
          </FormField>
          <FormField label="Cin7 ID">
            <Input value={formData.cin7_id || ''} onChange={e => set('cin7_id', e.target.value)} className="font-mono text-xs" />
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