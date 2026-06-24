import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X, Loader2, Search, Link2, ArrowLeft, Check, Truck, FileText } from 'lucide-react';
import { formatZAR, effectiveUnitCost } from '@/lib/utils';
import UomSelect from '@/components/shared/UomSelect';

/**
 * Match an unmatched invoice line (or a SKU group of lines) to an existing
 * catalogue Product and capture a full Purchasing Unit for the supplier link —
 * the same fields as the Products → Suppliers "Purchasing Units" editor,
 * pre-filled from the Xero line.
 */
export default function MatchToExistingModal({ lineGroup, invoice, products = [], possibleMatches = [], onMatch, onCancel }) {
  const line = lineGroup.representativeLine;
  const invoiceCount = lineGroup.lines.length;
  const suggestion = possibleMatches[0];
  const suggestedSp = suggestion?.supplierProduct;
  // True per-unit cost (repairs legacy rows that stored the line total).
  const lineUnitCost = effectiveUnitCost(line);
  const unitLabel = line.unit ? ` ${line.unit}` : '';

  const [search, setSearch] = useState('');
  // Pre-select the strongest possible-duplicate match so the reviewer can confirm
  // rather than search from scratch.
  const [picked, setPicked] = useState(suggestion?.product || null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    purchase_uom_label: suggestedSp?.purchase_uom_label || line.xero_description || '',
    purchase_uom: suggestedSp?.purchase_uom || 'each',
    conversion_factor: suggestedSp?.conversion_factor != null ? String(suggestedSp.conversion_factor) : '',
    yield_factor: suggestedSp?.yield_factor != null ? String(suggestedSp.yield_factor) : '1',
    nominal_cost: lineUnitCost ? String(lineUnitCost) : '',
    supplier_sku: line.xero_item_code || suggestedSp?.supplier_sku || '',
    supplier_description: line.xero_description || suggestedSp?.supplier_description || '',
    is_default: false,
  });
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const filtered = useMemo(() => {
    if (!search) return products.slice(0, 10);
    const q = search.toLowerCase();
    return products.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    ).slice(0, 10);
  }, [products, search]);

  const stockUom = picked?.stock_uom || 'stock';
  const cf = parseFloat(form.conversion_factor);
  const yf = parseFloat(form.yield_factor) || 1;
  const nc = parseFloat(form.nominal_cost);
  const pricePerStock = cf > 0 && nc >= 0 && yf > 0 ? nc / (cf * yf) : null;

  const handleSave = async () => {
    if (!form.purchase_uom_label.trim() || !form.conversion_factor || form.nominal_cost === '') {
      // surface via the parent's toast pattern by throwing through onMatch guard
      return;
    }
    setSaving(true);
    try {
      await onMatch(lineGroup, { product: picked, form });
    } finally {
      setSaving(false);
    }
  };

  const formInvalid = !form.purchase_uom_label.trim() || !form.conversion_factor || form.nominal_cost === '';

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-lg shadow-xl max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Link2 className="w-5 h-5 text-primary" /> Match to Existing Product
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1"><Truck className="w-3 h-3" /> {invoice?.supplier_name}</span>
              {line.xero_item_code && <span className="font-mono">SKU {line.xero_item_code}</span>}
              {invoiceCount > 1 && (
                <span className="text-amber-600 font-medium">on {invoiceCount} invoices</span>
              )}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Line context */}
          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
            <p className="font-medium">{line.xero_description || 'No description'}</p>
            <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
              {line.qty}{unitLabel} × {formatZAR(lineUnitCost)}
              {line.line_total != null && <span className="ml-1">= {formatZAR(line.line_total)}</span>}
            </p>
            {invoiceCount > 1 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Seen on: {lineGroup.lines.map(l => l.invoice?.invoice_number || '—').join(', ')}
              </p>
            )}
          </div>

          {/* Step 1: pick a catalogue product */}
          {!picked ? (
            <div className="space-y-2">
              {possibleMatches.length > 0 && (
                <div className="space-y-1.5 mb-2">
                  <Label className="text-xs text-amber-700">Possible matches</Label>
                  {possibleMatches.map(m => (
                    <button
                      key={m.product.id}
                      onClick={() => setPicked(m.product)}
                      className="w-full text-left px-3 py-2 rounded-lg bg-amber-50/60 hover:bg-amber-100 text-sm flex items-center justify-between border border-amber-200"
                    >
                      <div className="min-w-0">
                        <span className="font-medium">{m.product.name}</span>
                        <span className="font-mono text-muted-foreground ml-1 text-xs">({m.product.sku})</span>
                        <span className="block text-[11px] text-amber-700">{m.reasons.join(' · ')}</span>
                      </div>
                      <Link2 className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
              <Label className="text-xs">Search the product catalogue</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search by name or SKU..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="h-9 text-sm pl-8"
                  autoFocus
                />
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1">
                {filtered.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No products found. Use "Create Product" instead.</p>
                ) : filtered.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setPicked(p)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-primary/5 text-sm flex items-center justify-between border border-transparent hover:border-primary/20"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{p.name}</span>
                      <span className="font-mono text-muted-foreground ml-1 text-xs">({p.sku})</span>
                    </div>
                    <Link2 className="w-3.5 h-3.5 text-primary shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Step 2: capture the purchasing unit */
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <button onClick={() => setPicked(null)} className="text-muted-foreground hover:text-foreground" title="Pick a different product">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <span>Linking to <span className="font-medium">{picked.name}</span> <span className="font-mono text-muted-foreground text-xs">({picked.sku})</span></span>
              </div>

              <h4 className="text-sm font-semibold flex items-center gap-1.5 pt-1">
                <FileText className="w-4 h-4 text-muted-foreground" /> Purchasing Unit — {invoice?.supplier_name}
              </h4>
              {line.unit && (
                <p className="text-[11px] text-muted-foreground -mt-1">
                  Invoiced in <span className="font-medium">{line.unit}</span> at {formatZAR(lineUnitCost)}/{line.unit}.
                  Set the conversion to {picked.stock_uom || 'stock'} below (e.g. 1 {line.unit} = X {picked.stock_uom || 'stock'}).
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Purchase Unit Label *</Label>
                  <Input
                    placeholder="e.g. 25kg Bag, Case of 6"
                    value={form.purchase_uom_label}
                    onChange={e => set('purchase_uom_label', e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Purchase UoM *</Label>
                  <UomSelect value={form.purchase_uom} onValueChange={v => set('purchase_uom', v)} placeholder="Select unit" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Conversion Factor * (1 {form.purchase_uom} = X {stockUom})</Label>
                  <Input
                    type="number"
                    step="any"
                    placeholder={`e.g. 25 (1 ${form.purchase_uom} = 25 ${stockUom})`}
                    value={form.conversion_factor}
                    onChange={e => set('conversion_factor', e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Yield Factor (default 1.0)</Label>
                  <Input
                    type="number"
                    step="0.001"
                    placeholder="e.g. 0.95 for 5% waste"
                    value={form.yield_factor}
                    onChange={e => set('yield_factor', e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Nominal Cost (excl VAT) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 450.00"
                  value={form.nominal_cost}
                  onChange={e => set('nominal_cost', e.target.value)}
                />
              </div>

              {pricePerStock != null && (
                <div className="px-3 py-2 bg-background rounded-md border border-border text-sm">
                  <span className="text-muted-foreground">Price per {stockUom}: </span>
                  <span className="font-semibold text-foreground">{formatZAR(pricePerStock)}</span>
                  <span className="text-muted-foreground ml-1">(= {formatZAR(nc)} ÷ ({cf} × {yf}))</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Supplier SKU</Label>
                  <Input
                    placeholder="Supplier's product code"
                    value={form.supplier_sku}
                    onChange={e => set('supplier_sku', e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Supplier Description</Label>
                  <Input
                    placeholder="Supplier's name for this product"
                    value={form.supplier_description}
                    onChange={e => set('supplier_description', e.target.value)}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-muted-foreground pt-1 cursor-pointer">
                <input type="checkbox" checked={form.is_default} onChange={e => set('is_default', e.target.checked)} className="rounded" />
                Set as the default supplier for this product
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          {picked && (
            <Button className="flex-1 gap-2" onClick={handleSave} disabled={saving || formInvalid}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {saving
                ? 'Matching…'
                : invoiceCount > 1 ? `Match & save (${invoiceCount} lines)` : 'Match & save link'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
