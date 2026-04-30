import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowRightLeft, ChevronLeft, ChevronRight, ArrowDownRight, ArrowUpRight, ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

const REASON_LABELS = {
  receipt: 'Receipt',
  transfer: 'Transfer',
  production_consume: 'Production Use',
  production_yield: 'Production Output',
  sale_fulfillment: 'Order Fulfilled',
  wastage_usable: 'Wastage (Usable)',
  wastage_unusable: 'Wastage (Unusable)',
  stocktake_adjustment: 'Stock Count Adj.',
  return: 'Return',
  write_off: 'Write Off',
  packing_material: 'Packing Material',
};

const REASON_COLORS = {
  receipt: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  production_yield: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  return: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  transfer: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  sale_fulfillment: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  production_consume: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  wastage_usable: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  wastage_unusable: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  stocktake_adjustment: 'bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-400',
  write_off: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  packing_material: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
};

const OUT_REASONS = ['sale_fulfillment', 'production_consume', 'wastage_usable', 'wastage_unusable', 'write_off', 'packing_material'];

function DirectionIcon({ reason }) {
  const isOut = OUT_REASONS.includes(reason);
  if (reason === 'transfer') return <ArrowLeftRight className="w-3.5 h-3.5 text-purple-500" />;
  if (isOut) return <ArrowUpRight className="w-3.5 h-3.5 text-red-500" />;
  return <ArrowDownRight className="w-3.5 h-3.5 text-green-500" />;
}

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
              {movements.map(m => {
                const isOut = OUT_REASONS.includes(m.reason);
                const isAdj = m.reason === 'stocktake_adjustment';
                const sign = isAdj ? (m.from_location_id ? '-' : '+') : (isOut ? '-' : '+');
                const color = sign === '-' ? 'text-red-600' : 'text-green-600';
                
                return (
                  <tr key={m.id} className="hover:bg-muted/20">
                    <td className="px-2 py-2.5 text-center">
                      <DirectionIcon reason={m.reason} />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(m.created_date), 'dd MMM yyyy HH:mm')}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge className={`text-[10px] ${REASON_COLORS[m.reason] || 'bg-gray-100 text-gray-700'}`}>
                        {REASON_LABELS[m.reason] || m.reason}
                      </Badge>
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${color}`}>
                      {sign}{m.qty} {m.uom}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {m.ref_number ? (
                        <span className="font-medium text-foreground">{m.ref_number}</span>
                      ) : m.ref_type ? (
                        <span className="text-muted-foreground">{m.ref_type}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground truncate max-w-[200px]">
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