import React, { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link2, Unlink, Search, Check } from 'lucide-react';

const MATCH_STYLES = {
  auto_matched: 'bg-green-100 text-green-700',
  manually_matched: 'bg-blue-100 text-blue-700',
  unmatched: 'bg-amber-100 text-amber-700',
  non_stock_item: 'bg-gray-100 text-gray-500',
};

export default function InvoiceLineMatchRow({ line, supplierProducts, onMatch, onUnmatch, editable }) {
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

  const isMatched = line.match_status === 'auto_matched' || line.match_status === 'manually_matched';

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Badge className={`text-[10px] ${MATCH_STYLES[line.match_status] || ''}`}>
              {(line.match_status || 'unmatched').replace('_', ' ')}
            </Badge>
            {line.xero_item_code && (
              <span className="text-[10px] font-mono text-muted-foreground">{line.xero_item_code || '—'}</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate">{line.xero_description || '—'}</p>
          {isMatched && (
            <p className="text-sm font-medium mt-0.5 flex items-center gap-1">
              <Link2 className="w-3.5 h-3.5 text-primary" />
              {line?.product_name || '—'} <span className="font-mono text-xs text-muted-foreground">({line?.product_sku || '—'})</span>
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm tabular-nums">{line.qty} × R {(line.unit_cost || 0).toFixed(2)}</p>
          <p className="text-sm font-medium tabular-nums">R {(line.line_total || 0).toFixed(2)}</p>
        </div>
        {editable && (
          <div className="flex items-center gap-1 shrink-0">
            {isMatched ? (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => onUnmatch(line)}>
                <Unlink className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={() => setShowSearch(!showSearch)}>
                <Search className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Manual match search */}
      {showSearch && (
        <div className="px-4 pb-3 space-y-2">
          <Input
            placeholder="Search supplier products..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
          <div className="max-h-40 overflow-y-auto space-y-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No products found. Link this supplier's products first.</p>
            ) : filtered.map(sp => (
              <button
                key={sp.id}
                onClick={() => { onMatch(line, sp); setShowSearch(false); setSearch(''); }}
                className="w-full text-left px-3 py-1.5 rounded-md hover:bg-muted/50 text-xs flex items-center justify-between"
              >
                <span>{sp.product_name} <span className="font-mono text-muted-foreground">({sp.product_sku})</span></span>
                <Check className="w-3 h-3 text-primary opacity-0 group-hover:opacity-100" />
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowSearch(false)} className="text-xs">Cancel</Button>
        </div>
      )}
    </div>
  );
}