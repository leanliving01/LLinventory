import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, Factory } from 'lucide-react';

const PRODUCTION_LOCATION_ID = '__production_floor__';

export default function ProductionFloorBanner() {
  const [expanded, setExpanded] = useState(false);

  const { data: floorStock = [] } = useQuery({
    queryKey: ['production-floor-soh'],
    queryFn: () => base44.entities.StockOnHand.filter(
      { location_id: PRODUCTION_LOCATION_ID },
      'product_name', 500
    ),
  });

  const activeItems = useMemo(
    () => floorStock.filter(s => (s.qty_on_hand || 0) > 0),
    [floorStock]
  );

  if (activeItems.length === 0) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm"
      >
        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
          <Factory className="w-4 h-4" />
          <span className="font-semibold">Production Floor</span>
          <Badge variant="secondary" className="text-[10px]">
            {activeItems.length} items
          </Badge>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-amber-600" />
        ) : (
          <ChevronDown className="w-4 h-4 text-amber-600" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-amber-200 dark:border-amber-800">
                <th className="text-left py-1.5 font-medium">SKU</th>
                <th className="text-left py-1.5 font-medium">Product</th>
                <th className="text-right py-1.5 font-medium">Qty</th>
                <th className="text-left py-1.5 pl-2 font-medium">UoM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100 dark:divide-amber-900">
              {activeItems.map(s => (
                <tr key={s.id}>
                  <td className="py-1.5 font-mono text-xs">{s.product_sku}</td>
                  <td className="py-1.5">{s.product_name}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium">
                    {(s.qty_on_hand || 0).toLocaleString('en-ZA', { maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-1.5 pl-2 text-muted-foreground">{s.uom || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}