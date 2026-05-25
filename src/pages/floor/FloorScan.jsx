import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScanBarcode, Camera, Package, MapPin } from 'lucide-react';
import CameraScanner from '@/components/floor/CameraScanner';
import { toast } from 'sonner';

/**
 * Quick Scan — scan or type a barcode/SKU to look up product + stock info.
 * Useful for warehouse staff checking stock levels on the fly.
 */
export default function FloorScan() {
  const [query, setQuery] = useState('');
  const [matchedProduct, setMatchedProduct] = useState(null);
  const [showCamera, setShowCamera] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ['floor-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'sku', 2000),
    staleTime: 5 * 60 * 1000,
  });

  const { data: stockRecords = [] } = useQuery({
    queryKey: ['floor-stock'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 2000),
    staleTime: 60 * 1000,
  });

  const lookup = (code, fromScan = false) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;

    const found = products.find(p =>
      (p.barcode && p.barcode.toLowerCase() === trimmed) ||
      (p.sku && p.sku.toLowerCase() === trimmed)
    );

    if (found) {
      setMatchedProduct(found);
      if (fromScan) setQuery('');
      toast.success(`Found: ${found.name}`);
    } else {
      setMatchedProduct(null);
      toast.error(`No product for "${code.trim()}"`);
    }
    setShowCamera(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    lookup(query);
  };

  // Get stock for matched product
  const productStock = matchedProduct
    ? stockRecords.filter(s => s.product_id === matchedProduct.id)
    : [];
  const totalOnHand = productStock.reduce((s, r) => s + (r.qty_on_hand || 0), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Quick Scan</h1>

      {/* Search input + camera button */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="SKU or barcode..."
            className="h-14 text-lg font-mono pl-11"
            autoFocus
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-14 w-14 shrink-0"
          onClick={() => setShowCamera(true)}
        >
          <Camera className="w-6 h-6" />
        </Button>
      </form>

      {/* Camera scanner overlay */}
      {showCamera && (
        <CameraScanner
          active={showCamera}
          onScan={(code) => { setQuery(''); lookup(code, true); }}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* Result card */}
      {matchedProduct && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0">
              <Package className="w-6 h-6 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-lg leading-tight">{matchedProduct.name}</h2>
              <p className="text-sm font-mono text-muted-foreground">{matchedProduct.sku}</p>
              {matchedProduct.barcode && (
                <p className="text-xs text-muted-foreground">Barcode: {matchedProduct.barcode}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="outline">{matchedProduct.type}</Badge>
            <Badge variant="outline">{matchedProduct.stock_uom}</Badge>
          </div>

          {/* Stock by location */}
          <div className="pt-2 border-t border-border space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Total On Hand</span>
              <span className="text-3xl font-bold tabular-nums">{totalOnHand} {matchedProduct.stock_uom}</span>
            </div>
            {productStock.length > 0 && (
              <div className="space-y-1">
                {productStock.map(s => (
                  <div key={s.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5" /> {s.location_name || 'Unknown'}
                    </span>
                    <span className="tabular-nums text-base font-medium">{s.qty_on_hand || 0}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}