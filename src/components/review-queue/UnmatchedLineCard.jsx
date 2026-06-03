import React, { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Link2, Plus, Ban, Truck, FileText, Check, ArrowLeft } from 'lucide-react';

const PURCHASE_UOMS = ['each', 'case', 'box', 'bag', 'drum', 'pallet', 'kg', 'L'];

export default function UnmatchedLineCard({ line, invoice, products = [], onMatch, onCreateProduct, onMarkNonStock }) {
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(null); // selected catalogue product, then show enrichment form
  // Enrichment form (pre-filled from the Xero line)
  const [supplierSku, setSupplierSku] = useState(line.xero_item_code || '');
  const [description, setDescription] = useState(line.xero_description || '');
  const [purchaseUom, setPurchaseUom] = useState('each');
  const [conversion, setConversion] = useState('1');
  const [unitCost, setUnitCost] = useState(line.unit_cost != null ? String(line.unit_cost) : '');
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    if (!search) return products.slice(0, 8);
    const q = search.toLowerCase();
    return products.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    ).slice(0, 8);
  }, [products, search]);

  const resetMatch = () => {
    setShowSearch(false); setSearch(''); setPicked(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onMatch(line, {
        product: picked,
        supplierSku: supplierSku.trim(),
        description: description.trim(),
        purchaseUom,
        conversion,
        unitCost,
      });
      resetMatch();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center mt-0.5 shrink-0">
          <FileText className="w-4 h-4 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{line.xero_description || 'No description'}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {line.xero_item_code && (
              <Badge variant="outline" className="text-[10px] font-mono">{line.xero_item_code}</Badge>
            )}
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Truck className="w-3 h-3" /> {invoice?.supplier_name}
            </span>
            <span className="text-xs font-mono text-muted-foreground">{invoice?.invoice_number}</span>
            {line.account_code && (
              <span className="text-[10px] text-muted-foreground">Acct: {line.account_code}</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm tabular-nums">{line.qty} × R {(line.unit_cost || 0).toFixed(2)}</p>
          <p className="text-sm font-bold tabular-nums">R {(line.line_total || 0).toFixed(2)}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-2 border-t border-border bg-muted/20 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => { setShowSearch(!showSearch); setPicked(null); }} className="gap-1.5 text-xs">
          <Link2 className="w-3.5 h-3.5" /> Match Existing
        </Button>
        <Button variant="outline" size="sm" onClick={() => onCreateProduct(line, invoice)} className="gap-1.5 text-xs">
          <Plus className="w-3.5 h-3.5" /> Create Product
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onMarkNonStock(line)} className="gap-1.5 text-xs text-muted-foreground">
          <Ban className="w-3.5 h-3.5" /> Non-stock
        </Button>
      </div>

      {/* Inline match: search the product catalogue */}
      {showSearch && !picked && (
        <div className="px-4 py-3 border-t border-border space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search the product catalogue..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-sm pl-8"
              autoFocus
            />
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No products found. Use "Create Product" instead.</p>
            ) : filtered.map(p => (
              <button
                key={p.id}
                onClick={() => setPicked(p)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-primary/5 text-xs flex items-center justify-between border border-transparent hover:border-primary/20"
              >
                <div>
                  <span className="font-medium">{p.name}</span>
                  <span className="font-mono text-muted-foreground ml-1">({p.sku})</span>
                </div>
                <Link2 className="w-3 h-3 text-primary" />
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={resetMatch} className="text-xs">Cancel</Button>
        </div>
      )}

      {/* Inline enrichment form: confirm the supplier link details before saving */}
      {showSearch && picked && (
        <div className="px-4 py-3 border-t border-border space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => setPicked(null)} className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /></button>
            <span>Link to <span className="font-medium">{picked.name}</span> <span className="font-mono text-muted-foreground">({picked.sku})</span></span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Supplier SKU</Label>
              <Input value={supplierSku} onChange={e => setSupplierSku(e.target.value)} className="h-8 text-sm font-mono" placeholder="Supplier's code" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Purchase UoM</Label>
              <Select value={purchaseUom} onValueChange={setPurchaseUom}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PURCHASE_UOMS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-[10px] uppercase text-muted-foreground">Supplier Description</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} className="h-8 text-sm" placeholder="Supplier's name for this item" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Conversion (1 {purchaseUom} = X {picked.stock_uom || 'stock'})</Label>
              <Input type="number" step="any" value={conversion} onChange={e => setConversion(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Unit Cost (excl. VAT)</Label>
              <Input type="number" step="0.01" value={unitCost} onChange={e => setUnitCost(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={resetMatch} className="text-xs">Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5 text-xs">
              <Check className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Match & save link'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
