import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronDown, ChevronUp, Search } from 'lucide-react';

export default function UnmatchedLineRow({ group, products, onLink }) {
  const [expanded, setExpanded] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [linking, setLinking] = useState(false);

  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return products.slice(0, 15);
    const q = productSearch.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    ).slice(0, 15);
  }, [products, productSearch]);

  const handleLink = async (productId) => {
    setLinking(true);
    await onLink(group.name, productId);
    setLinking(false);
    setExpanded(false);
  };

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <span className="text-sm font-medium truncate">{group.name}</span>
        </button>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {group.lines.length} line{group.lines.length !== 1 ? 's' : ''}
        </Badge>
        <span className="text-xs text-muted-foreground shrink-0 w-28 text-right">
          R {group.totalValue.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>

      {expanded && (
        <div className="mt-3 ml-6 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search products to link..."
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
          <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
            {filteredProducts.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No products found</div>
            ) : (
              filteredProducts.map(p => (
                <button
                  key={p.id}
                  onClick={() => handleLink(p.id)}
                  disabled={linking}
                  className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors text-sm"
                >
                  <Check className="w-3.5 h-3.5 text-green-500 opacity-0 group-hover:opacity-100" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.sku} · {p.stock_uom}{p.purchase_uom ? ` · Buy: ${p.purchase_uom}` : ''}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{p.type}</Badge>
                </button>
              ))
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Click a product to link all {group.lines.length} "{group.name}" lines to it
          </p>
        </div>
      )}
    </div>
  );
}