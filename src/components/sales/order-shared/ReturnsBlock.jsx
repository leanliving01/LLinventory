import React from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { STATUS_LABELS as RETURN_STATUS_LABELS, STATUS_COLORS as RETURN_STATUS_COLORS } from '@/lib/shopifyReturns';

/** List of returns linked to an order, each linking to its return detail page. */
export default function ReturnsBlock({ returns = [] }) {
  if (returns.length === 0) {
    return (
      <p className="text-xs text-muted-foreground rounded-lg border bg-card p-3">
        No returns recorded against this order.
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3">
      <p className="text-xs font-semibold text-rose-700 mb-2 flex items-center gap-1.5">
        <RotateCcw className="w-3.5 h-3.5" /> {returns.length} Return{returns.length > 1 ? 's' : ''}
      </p>
      <div className="space-y-1.5">
        {returns.map((r) => (
          <Link
            key={r.id}
            to={`/sales/returns/${r.id}`}
            className="flex flex-wrap items-center gap-2 text-xs hover:underline"
          >
            <span className="font-mono">{r.return_number}</span>
            <Badge className={`text-[10px] py-0 ${RETURN_STATUS_COLORS[r.status] || ''}`}>
              {RETURN_STATUS_LABELS[r.status] || r.status}
            </Badge>
            <span className="text-muted-foreground">return R {(r.total_return_value || 0).toFixed(2)}</span>
            {(r.refund_amount || 0) > 0 && (
              <span className="text-purple-600">refund R {r.refund_amount.toFixed(2)}</span>
            )}
            {(r.total_write_off_value || 0) > 0 && (
              <span className="text-rose-600">write-off R {r.total_write_off_value.toFixed(2)}</span>
            )}
            {r.courier_responsibility && (
              <span className="text-muted-foreground">
                · {r.courier_responsibility === 'us' ? 'we book courier' : 'customer courier'}
                {r.courier_status ? ` (${r.courier_status})` : ''}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
