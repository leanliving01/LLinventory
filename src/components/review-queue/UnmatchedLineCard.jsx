import React, { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Link2, Plus, Ban, Truck, FileText } from 'lucide-react';

export default function UnmatchedLineCard({ line, invoice, supplierProducts, onMatch, onCreateProduct, onMarkNonStock }) {
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return supplierProducts.slice(0, 8);
    const q = search.toLowerCase();
    return supplierProducts.filter(sp =>
      (sp.product_name || '').toLowerCase().includes(q) ||
      (sp.product_sku || '').toLowerCase().includes(q) ||
      (sp.xero_item_code || '').toLowerCase().includes(q)
    ).slice(0, 8);
  }, [supplierProducts, search]);

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
        <Button variant="outline" size="sm" onClick={() => setShowSearch(!showSearch)} className="gap-1.5 text-xs">
          <Link2 className="w-3.5 h-3.5" /> Match Existing
        </Button>
        <Button variant="outline" size="sm" onClick={() => onCreateProduct(line, invoice)} className="gap-1.5 text-xs">
          <Plus className="w-3.5 h-3.5" /> Create Product
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onMarkNonStock(line)} className="gap-1.5 text-xs text-muted-foreground">
          <Ban className="w-3.5 h-3.5" /> Non-stock
        </Button>
      </div>

      {/* Inline match search */}
      {showSearch && (
        <div className="px-4 py-3 border-t border-border space-y-2">
          <Input
            placeholder="Search supplier products..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
          <div className="max-h-40 overflow-y-auto space-y-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No products found for this supplier. Use "Create Product" instead.
              </p>
            ) : filtered.map(sp => (
              <button
                key={sp.id}
                onClick={() => { onMatch(line, sp); setShowSearch(false); setSearch(''); }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-primary/5 text-xs flex items-center justify-between border border-transparent hover:border-primary/20"
              >
                <div>
                  <span className="font-medium">{sp.product_name}</span>
                  <span className="font-mono text-muted-foreground ml-1">({sp.product_sku})</span>
                  {sp.xero_item_code && (
                    <span className="text-muted-foreground ml-2">Xero: {sp.xero_item_code}</span>
                  )}
                </div>
                <Link2 className="w-3 h-3 text-primary" />
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowSearch(false)} className="text-xs">Cancel</Button>
        </div>
      )}
    </div>
  );
}