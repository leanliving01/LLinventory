import React, { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, ScanBarcode, Camera } from 'lucide-react';
import CameraScanner from '@/components/floor/CameraScanner';

/**
 * Reusable mobile product search + barcode scan for floor modules.
 * Returns matched product object via onSelect.
 */
export default function FloorProductSearch({ products, onSelect, placeholder = 'Search or scan...' }) {
  const [query, setQuery] = useState('');
  const [showCamera, setShowCamera] = useState(false);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    return products.filter(p =>
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.sku && p.sku.toLowerCase().includes(q)) ||
      (p.barcode && p.barcode.toLowerCase() === q)
    ).slice(0, 10);
  }, [query, products]);

  const handleBarcodeScan = (code) => {
    const trimmed = code.trim().toLowerCase();
    const found = products.find(p =>
      (p.barcode && p.barcode.toLowerCase() === trimmed) ||
      (p.sku && p.sku.toLowerCase() === trimmed)
    );
    if (found) {
      onSelect(found);
      setQuery('');
    } else {
      setQuery(code.trim());
    }
    setShowCamera(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (results.length === 1) {
      onSelect(results[0]);
      setQuery('');
    }
  };

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={placeholder}
            className="h-12 text-base pl-11 font-mono"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-12 w-12 shrink-0"
          onClick={() => setShowCamera(true)}
        >
          <Camera className="w-5 h-5" />
        </Button>
      </form>

      {showCamera && (
        <CameraScanner
          active={showCamera}
          onScan={handleBarcodeScan}
          onClose={() => setShowCamera(false)}
        />
      )}

      {query.trim() && results.length > 0 && (
        <div className="bg-card border border-border rounded-xl divide-y divide-border max-h-60 overflow-y-auto">
          {results.map(p => (
            <button
              key={p.id}
              onClick={() => { onSelect(p); setQuery(''); }}
              className="w-full text-left px-4 py-3 flex items-center justify-between active:bg-muted/60"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{p.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{p.sku}</p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0 ml-2">{p.stock_uom}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}