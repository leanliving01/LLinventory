import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowRightLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MovementRow from '@/components/movements/MovementRow';

const PAGE_SIZE = 15;

export default function ProductMovementsTab({ productId }) {
  const [page, setPage] = useState(0);

  const { data: movements = [], isLoading } = useQuery({
    queryKey: ['product-movements', productId, page],
    queryFn: () => base44.entities.StockMovement.filter(
      { product_id: productId },
      '-created_date',
      PAGE_SIZE,
      page * PAGE_SIZE
    ),
    enabled: !!productId,
  });

  if (isLoading) {
    return <div className="text-center py-8 text-sm text-muted-foreground">Loading movements...</div>;
  }

  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-muted-foreground" /> Stock Movements
          </h3>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-2">Page {page + 1}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={movements.length < PAGE_SIZE} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
        {movements.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No movements recorded for this product
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground bg-muted/20">
                <th className="w-8 px-2 py-2.5"></th>
                <th className="text-left px-3 py-2.5 font-medium">Date</th>
                <th className="text-left px-3 py-2.5 font-medium">Reason</th>
                <th className="text-right px-3 py-2.5 font-medium">Qty</th>
                <th className="text-left px-3 py-2.5 font-medium">Reference</th>
                <th className="text-left px-3 py-2.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {movements.map(m => (
                <MovementRow key={m.id} movement={m} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}