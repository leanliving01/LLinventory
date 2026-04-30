import React from 'react';
import { Badge } from '@/components/ui/badge';
import { ArrowDownRight, ArrowUpRight, ArrowLeftRight } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

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

function DirectionIcon({ reason, fromLoc }) {
  if (reason === 'transfer') return <ArrowLeftRight className="w-3.5 h-3.5 text-purple-500" />;
  if (reason === 'stocktake_adjustment') {
    return fromLoc ? <ArrowUpRight className="w-3.5 h-3.5 text-red-500" /> : <ArrowDownRight className="w-3.5 h-3.5 text-green-500" />;
  }
  if (OUT_REASONS.includes(reason)) return <ArrowUpRight className="w-3.5 h-3.5 text-red-500" />;
  return <ArrowDownRight className="w-3.5 h-3.5 text-green-500" />;
}

function getSign(reason, fromLoc) {
  if (reason === 'stocktake_adjustment') return fromLoc ? '-' : '+';
  if (OUT_REASONS.includes(reason)) return '-';
  return '+';
}

export default function MovementRow({ movement: m, showProduct = false }) {
  const sign = getSign(m.reason, m.from_location_id);
  const color = sign === '-' ? 'text-red-600' : 'text-green-600';

  return (
    <tr className="hover:bg-muted/20">
      <td className="px-2 py-2.5 text-center">
        <DirectionIcon reason={m.reason} fromLoc={m.from_location_id} />
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
        {format(new Date(m.created_date), 'dd MMM yyyy HH:mm')}
      </td>
      {showProduct && (
        <td className="px-3 py-2.5">
          <Link
            to={`/catalog/${m.product_id}`}
            className="text-xs font-medium hover:text-primary transition-colors"
          >
            <span className="font-mono text-[10px] text-muted-foreground">{m.product_sku}</span>
            <br />
            <span className="text-foreground">{m.product_name}</span>
          </Link>
        </td>
      )}
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
}