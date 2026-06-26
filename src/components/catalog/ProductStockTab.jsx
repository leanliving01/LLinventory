import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Warehouse, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StockAdjustmentModal from './StockAdjustmentModal';
import ProductCountUomEditor from './ProductCountUomEditor';
import CommittedOrdersModal from './CommittedOrdersModal';

export default function ProductStockTab({ productId }) {
  const [showAdjust, setShowAdjust] = useState(false);
  const [showCommitted, setShowCommitted] = useState(false);

  const { data: product } = useQuery({
    queryKey: ['product', productId],
    queryFn: async () => {
      const products = await base44.entities.Product.filter({ id: productId });
      return products[0] || null;
    },
    enabled: !!productId,
  });

  const { data: stockRecords = [], isLoading } = useQuery({
    queryKey: ['product-stock', productId],
    queryFn: () => base44.entities.StockOnHand.filter({ product_id: productId }),
    enabled: !!productId,
  });

  const totalOnHand = stockRecords.reduce((s, r) => s + (r.qty_on_hand || 0), 0);
  const totalCommitted = stockRecords.reduce((s, r) => s + (r.qty_committed || 0), 0);
  const totalAvailable = stockRecords.reduce((s, r) => s + (r.qty_available || 0), 0);
  const uom = stockRecords[0]?.uom || '';

  if (isLoading) {
    return <div className="text-center py-8 text-sm text-muted-foreground">Loading stock...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="On Hand" value={totalOnHand} uom={uom} />
        <SummaryCard
          label="Committed"
          value={totalCommitted}
          uom={uom}
          className="text-amber-600"
          onClick={product?.sku ? () => setShowCommitted(true) : undefined}
          hint={product?.sku && totalCommitted > 0 ? 'View orders' : undefined}
        />
        <SummaryCard label="Available" value={totalAvailable} uom={uom} className={totalAvailable < 0 ? 'text-red-600' : 'text-green-600'} />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Warehouse className="w-4 h-4 text-muted-foreground" /> Stock by Location
          </h3>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowAdjust(true)}>
            <PenLine className="w-3.5 h-3.5" /> Adjust Stock
          </Button>
        </div>
        {stockRecords.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No stock records for this product
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground bg-muted/20">
                <th className="text-left px-4 py-2.5 font-medium">Location</th>
                <th className="text-right px-4 py-2.5 font-medium">On Hand</th>
                <th className="text-right px-4 py-2.5 font-medium">Committed</th>
                <th className="text-right px-4 py-2.5 font-medium">Available</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stockRecords.map(s => (
                <tr key={s.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium">{s.location_name || 'Unknown'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{s.qty_on_hand || 0} {s.uom}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-amber-600">
                    {(s.qty_committed || 0) > 0 && product?.sku ? (
                      <button
                        className="hover:underline font-medium"
                        onClick={() => setShowCommitted(true)}
                        title="View orders this is committed to"
                      >
                        {s.qty_committed}
                      </button>
                    ) : (
                      s.qty_committed || 0
                    )}
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${(s.qty_available || 0) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {s.qty_available || 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ProductCountUomEditor productId={productId} product={product} />

      {showAdjust && product && (
        <StockAdjustmentModal
          product={product}
          onClose={() => setShowAdjust(false)}
        />
      )}

      {showCommitted && product?.sku && (
        <CommittedOrdersModal
          sku={product.sku}
          productName={product.name}
          committedTotal={totalCommitted}
          onClose={() => setShowCommitted(false)}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, uom, className = '', onClick, hint }) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      className={`bg-card border border-border rounded-xl px-4 py-3 ${clickable ? 'cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors' : ''}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center justify-between">
        {label}
        {clickable && hint && <span className="text-[9px] text-primary normal-case font-medium">{hint} →</span>}
      </p>
      <p className={`text-lg font-bold tabular-nums ${className}`}>{value} <span className="text-xs font-normal text-muted-foreground">{uom}</span></p>
    </div>
  );
}