import React from 'react';
import { Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import OrderLinesTable from '../order-shared/OrderLinesTable';

export default function OrderLinesTab({ lines = [], loading = false }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
        <Package className="w-3.5 h-3.5" /> Inventory Product Lines
        <Badge variant="outline" className="text-[10px] py-0 border-emerald-300 text-emerald-700">
          affects stock
        </Badge>
      </p>
      <OrderLinesTable lines={lines} loading={loading} />
    </div>
  );
}
