import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RotateCcw } from 'lucide-react';
import { formatDateTimeSAST } from '@/lib/dateUtils';
import { money } from '../order-shared/money';

/**
 * Refunds & adjustments. Financial refund lines + payment adjustments.
 * If the order is NOT fulfilled, refunds are labelled as a pre-fulfilment
 * financial adjustment (not a return).
 */
export default function RefundsTab({ order, financialLines = [] }) {
  const refundLines = financialLines.filter((l) => l.category === 'refund');
  const adjustmentLines = financialLines.filter((l) =>
    ['payment_adjustment', 'tip'].includes(l.category)
  );
  const isFulfilled = order.lifecycle_state === 'fulfilled';
  const preFulfilment = !isFulfilled;

  const hasAny = refundLines.length > 0 || adjustmentLines.length > 0;

  return (
    <div className="space-y-4">
      {preFulfilment && refundLines.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800">
          This order is not fulfilled — refunds below are recorded as a{' '}
          <strong>pre-fulfilment financial adjustment</strong>, not a stock return.
        </div>
      )}

      <Card className="p-4">
        <p className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <RotateCcw className="w-4 h-4" /> Refunds
        </p>
        {refundLines.length === 0 ? (
          <p className="text-xs text-muted-foreground">No refund lines recorded.</p>
        ) : (
          <div className="space-y-1.5">
            {refundLines.map((l) => (
              <div key={l.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  {l.label || 'Refund'}
                  {preFulfilment ? (
                    <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">
                      pre-fulfilment adjustment
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] border-rose-300 text-rose-700">
                      post-fulfilment refund
                    </Badge>
                  )}
                  {l.created_date && (
                    <span className="text-xs text-muted-foreground">{formatDateTimeSAST(l.created_date)}</span>
                  )}
                </span>
                <span className="font-medium text-rose-600">−{money(l.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold mb-3">Payment Adjustments</p>
        {adjustmentLines.length === 0 ? (
          <p className="text-xs text-muted-foreground">No payment adjustments recorded.</p>
        ) : (
          <div className="space-y-1.5">
            {adjustmentLines.map((l) => (
              <div key={l.id} className="flex items-center justify-between text-sm">
                <span>{l.label || l.category}</span>
                <span className={`font-medium ${l.sign < 0 ? 'text-rose-600' : ''}`}>
                  {l.sign < 0 ? '−' : ''}
                  {money(l.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {!hasAny && (
        <p className="text-xs text-muted-foreground">
          For physical stock returns, see the Returns tab.
        </p>
      )}
    </div>
  );
}
