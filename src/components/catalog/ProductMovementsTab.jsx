import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowRightLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

const REASON_LABELS = {
  receipt: 'Receipt',
  transfer: 'Transfer',
  production_consume: 'Production (In)',
  production_yield: 'Production (Out)',
  sale_fulfillment: 'Sale Fulfillment',
  wastage_usable: 'Wastage (Usable)',
  wastage_unusable: 'Wastage (Unusable)',
  stocktake_adjustment: 'Stock Take Adj.',
  return: 'Return',
  write_off: 'Write Off',
};

const REASON_COLORS = {
  receipt: 'bg-green-100 text-green-700',
  production_yield: 'bg-blue-100 text-blue-700',
  return: 'bg-green-100 text-green-700',
  transfer: 'bg-purple-100 text-purple-700',
  sale_fulfillment: 'bg-orange-100 text-orange-700',
  production_consume: 'bg-blue-100 text-blue-700',
  wastage_usable: 'bg-yellow-100 text-yellow-700',
  wastage_unusable: 'bg-red-100 text-red-700',
  stocktake_adjustment: 'bg-gray-100 text-gray-700',
  write_off: 'bg-red-100 text-red-700',
};

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
                <th className="text-left px-4 py-2.5 font-medium">Date</th>
                <th className="text-left px-4 py-2.5 font-medium">Reason</th>
                <th className="text-right px-4 py-2.5 font-medium">Qty</th>
                <th className="text-left px-4 py-2.5 font-medium">Reference</th>
                <th className="text-left px-4 py-2.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {movements.map(m => {
                const isOut = ['sale_fulfillment', 'production_consume', 'wastage_usable', 'wastage_unusable', 'write_off'].includes(m.reason);
                const sign = isOut ? '-' : '+';
                
                return (
                  <tr key={m.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(m.created_date), 'dd MMM yyyy HH:mm')}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge className={`text-[10px] ${REASON_COLORS[m.reason] || 'bg-gray-100 text-gray-700'}`}>
                        {REASON_LABELS[m.reason] || m.reason}
                      </Badge>
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${isOut ? 'text-red-600' : 'text-green-600'}`}>
                      {sign}{m.qty} {m.uom}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">
                      {m.ref_type ? `${m.ref_type}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-[200px]">
                      {m.notes || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}