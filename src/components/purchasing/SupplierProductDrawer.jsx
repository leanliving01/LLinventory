import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  X, Save, Loader2, Pencil, Star, Package, Truck, ArrowRightLeft,
  TrendingUp, DollarSign, Clock, ExternalLink, Percent
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const PURCHASE_UOMS = ['case', 'bag', 'drum', 'pallet', 'box', 'each', 'kg', 'L'];

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">{label}</label>
      {children}
    </div>
  );
}

function ReadRow({ icon: Icon, label, value }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
      <div>
        <p className="text-[10px] uppercase text-muted-foreground font-semibold">{label}</p>
        <p className="text-sm">{value}</p>
      </div>
    </div>
  );
}

export default function SupplierProductDrawer({ sp, onClose, onUpdated, canEdit }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [liveSp, setLiveSp] = useState(sp);
  const [form, setForm] = useState({ ...sp });
  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  // Tax rates for dropdown
  const { data: taxRates = [] } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => base44.entities.TaxRate.filter({ active: true }, 'name', 20),
    staleTime: 300000,
  });

  // Price history
  const { data: priceHistory = [] } = useQuery({
    queryKey: ['sp-price-history', sp.id],
    queryFn: () => base44.entities.SupplierPriceHistory.filter(
      { supplier_product_id: sp.id }, '-effective_date', 10
    ),
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const cf = parseFloat(form.conversion_factor) || 1;
      const yf = parseFloat(form.yield_factor) || 1;
      const data = {
        ...form,
        conversion_factor: cf,
        yield_factor: yf,
        effective_internal_qty: Math.round(cf * yf * 1000) / 1000,
        purchase_uom_qty: parseFloat(form.purchase_uom_qty) || 1,
        last_purchase_price: parseFloat(form.last_purchase_price) || 0,
        min_order_qty: parseFloat(form.min_order_qty) || 0,
        lead_time_days: parseInt(form.lead_time_days) || 1,
        price_variance_threshold: parseFloat(form.price_variance_threshold) || 0.1,
      };
      const updated = await base44.entities.SupplierProduct.update(sp.id, data);
      setLiveSp(updated);
      toast.success('Supplier product updated');
      setEditing(false);
      onUpdated?.();
    } catch (err) {
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const effectiveQty = ((form.conversion_factor || 1) * (form.yield_factor || 1)).toFixed(3);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-card shadow-xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-start justify-between z-10 shrink-0">
          <div>
            <Badge className={`text-[10px] mb-1 ${liveSp.active !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {liveSp.active !== false ? 'Active' : 'Inactive'}
            </Badge>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" />
              {liveSp.product_name || 'Supplier Product'}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {liveSp.supplier_name} · {liveSp.product_sku}
              {liveSp.is_default_supplier && <Star className="inline w-3 h-3 text-amber-500 fill-amber-500 ml-1" />}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {canEdit && !editing && (
              <Button variant="ghost" size="icon" onClick={() => setEditing(true)}>
                <Pencil className="w-4 h-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {editing ? (
            <EditForm form={form} set={set} effectiveQty={effectiveQty} taxRates={taxRates} />
          ) : (
            <ReadView sp={liveSp} effectiveQty={effectiveQty} />
          )}

          {/* Price History */}
          {priceHistory.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-primary" />
                Price History (last 10)
              </h3>
              <div className="bg-muted/30 border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Date</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Price</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Change</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {priceHistory.map(ph => (
                      <tr key={ph.id} className="text-xs">
                        <td className="px-3 py-2">{ph.effective_date || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">R {(ph.price || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {ph.change_pct != null ? (
                            <span className={ph.change_pct > 0 ? 'text-red-600' : ph.change_pct < 0 ? 'text-green-600' : ''}>
                              {ph.change_pct > 0 ? '+' : ''}{ph.change_pct.toFixed(1)}%
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{(ph.source || '').replace('_', ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {editing && (
          <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 shrink-0 flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => { setEditing(false); setForm({ ...sp }); }}>Cancel</Button>
            <Button className="flex-1 gap-2" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ReadView({ sp, effectiveQty }) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Identification</h3>
        <ReadRow icon={Truck} label="Supplier" value={sp.supplier_name} />
        <ReadRow icon={Package} label="Internal Product" value={`${sp.product_name} (${sp.product_sku})`} />
        <ReadRow icon={Package} label="Supplier SKU" value={sp.supplier_sku} />
        <ReadRow icon={Package} label="Supplier Description" value={sp.supplier_description} />
        <ReadRow icon={Package} label="Xero Item Code" value={sp.xero_item_code} />
        {sp.supplier_product_url && (
          <div className="flex items-start gap-3">
            <ExternalLink className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Supplier Product URL</p>
              <a
                href={sp.supplier_product_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline break-all"
              >
                {sp.supplier_product_url}
              </a>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-primary" /> UoM Conversion
        </h3>
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Purchase UoM</span>
            <span className="font-medium">{sp.purchase_uom_label || sp.purchase_uom || '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">1 purchase unit =</span>
            <span className="font-medium">{sp.conversion_factor || 1} {sp.conversion_uom || '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Yield factor</span>
            <span className="font-medium">{((sp.yield_factor || 1) * 100).toFixed(0)}%</span>
          </div>
          <div className="border-t border-primary/20 pt-2 flex justify-between text-sm">
            <span className="text-muted-foreground font-semibold">Effective stock per unit</span>
            <span className="font-bold text-primary">{effectiveQty} {sp.conversion_uom || ''}</span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-primary" /> Pricing & Ordering
        </h3>
        <ReadRow icon={DollarSign} label="Last Purchase Price" value={`R ${(sp.last_purchase_price || 0).toFixed(2)} per ${sp.purchase_uom || 'unit'}`} />
        <ReadRow icon={DollarSign} label="Price Variance Threshold" value={`${((sp.price_variance_threshold || 0.1) * 100).toFixed(0)}%`} />
        <ReadRow icon={Clock} label="Lead Time" value={`${sp.lead_time_days || 1} day(s)`} />
        <ReadRow icon={Package} label="Min Order Qty" value={sp.min_order_qty ? `${sp.min_order_qty} ${sp.purchase_uom || ''}` : null} />
      </div>

      {sp.notes && (
        <div>
          <h3 className="text-sm font-semibold mb-1">Notes</h3>
          <p className="text-sm text-muted-foreground">{sp.notes}</p>
        </div>
      )}
    </div>
  );
}

function EditForm({ form, set, effectiveQty, taxRates = [] }) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Identification</h3>
        <Field label="Supplier SKU">
          <Input value={form.supplier_sku || ''} onChange={e => set('supplier_sku', e.target.value)} className="h-8 text-sm" />
        </Field>
        <Field label="Supplier Description (invoice name)">
          <Input value={form.supplier_description || ''} onChange={e => set('supplier_description', e.target.value)} className="h-8 text-sm" />
        </Field>
        <Field label="Xero Item Code">
          <Input value={form.xero_item_code || ''} onChange={e => set('xero_item_code', e.target.value)} className="h-8 text-sm" />
        </Field>
        <Field label="Supplier Product URL (website link)">
          <Input
            type="url"
            placeholder="https://supplier.com/product/..."
            value={form.supplier_product_url || ''}
            onChange={e => set('supplier_product_url', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">UoM Conversion</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Purchase UoM">
            <Select value={form.purchase_uom || ''} onValueChange={v => set('purchase_uom', v)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PURCHASE_UOMS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="UoM Qty (e.g. 6 for case of 6)">
            <Input type="number" value={form.purchase_uom_qty || ''} onChange={e => set('purchase_uom_qty', e.target.value)} className="h-8 text-sm" />
          </Field>
        </div>
        <Field label="Purchase UoM Label (e.g. Case of 6 × 1kg)">
          <Input value={form.purchase_uom_label || ''} onChange={e => set('purchase_uom_label', e.target.value)} className="h-8 text-sm" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Conversion Factor (1 unit = X stock)">
            <Input type="number" step="0.01" value={form.conversion_factor || ''} onChange={e => set('conversion_factor', e.target.value)} className="h-8 text-sm" />
          </Field>
          <Field label="Conversion UoM (must match stock_uom)">
            <Input value={form.conversion_uom || ''} onChange={e => set('conversion_uom', e.target.value)} className="h-8 text-sm" />
          </Field>
        </div>
        <Field label="Yield Factor (0.0–1.0, e.g. 0.92 = 8% loss)">
          <Input type="number" step="0.01" min="0" max="1" value={form.yield_factor || ''} onChange={e => set('yield_factor', e.target.value)} className="h-8 text-sm" />
        </Field>
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm">
          <span className="text-muted-foreground">Effective stock per purchase unit: </span>
          <span className="font-bold text-primary">{effectiveQty} {form.conversion_uom || ''}</span>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Pricing & Ordering</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Last Purchase Price (ZAR)">
            <Input type="number" step="0.01" value={form.last_purchase_price || ''} onChange={e => set('last_purchase_price', e.target.value)} className="h-8 text-sm" />
          </Field>
          <Field label="Price Variance Threshold (decimal)">
            <Input type="number" step="0.01" value={form.price_variance_threshold || ''} onChange={e => set('price_variance_threshold', e.target.value)} className="h-8 text-sm" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lead Time (days)">
            <Input type="number" value={form.lead_time_days || ''} onChange={e => set('lead_time_days', e.target.value)} className="h-8 text-sm" />
          </Field>
          <Field label="Min Order Qty">
            <Input type="number" value={form.min_order_qty || ''} onChange={e => set('min_order_qty', e.target.value)} className="h-8 text-sm" />
          </Field>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Other</h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_default_supplier || false}
              onChange={e => set('is_default_supplier', e.target.checked)}
              className="rounded"
            />
            Default supplier for this product
          </label>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.active !== false}
              onChange={e => set('active', e.target.checked)}
              className="rounded"
            />
            Active
          </label>
        </div>
        <Field label="Notes">
          <Textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} className="h-16 text-sm" />
        </Field>
        {taxRates.length > 0 && (
          <Field label="Default VAT for this product">
            <Select value={form.default_tax_rate_id || '_none'} onValueChange={v => set('default_tax_rate_id', v === '_none' ? '' : v)}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Use supplier / system default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Use supplier / system default</SelectItem>
                {taxRates.map(r => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} ({(r.rate * 100).toFixed(0)}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>
    </div>
  );
}