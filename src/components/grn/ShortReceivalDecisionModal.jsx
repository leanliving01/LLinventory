import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, AlertTriangle, Clock, CreditCard } from 'lucide-react';

/**
 * Shown when a GRN has short-received stock lines.
 * Props: { grn, shortLines, onConfirm, onCancel }
 * onConfirm receives: { [lineId]: 'receive_later' | 'request_credit' }
 */
export default function ShortReceivalDecisionModal({ grn, shortLines, onConfirm, onCancel }) {
  // Default all lines to 'receive_later'
  const [decisions, setDecisions] = useState(() =>
    Object.fromEntries(shortLines.map(l => [l.id, 'receive_later']))
  );

  const setDecision = (lineId, value) => {
    setDecisions(prev => ({ ...prev, [lineId]: value }));
  };

  const totalShortValue = shortLines.reduce((sum, l) => {
    const shortQty = parseFloat(l.expected_qty) - parseFloat(l.received_qty);
    return sum + shortQty * (parseFloat(l.unit_cost) || 0);
  }, 0);

  const creditCount = Object.values(decisions).filter(d => d === 'request_credit').length;

  return (
    <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h3 className="text-lg font-bold">Short-Received Items — Action Required</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Description */}
        <div className="px-6 py-3 bg-amber-50 border-b border-amber-100">
          <p className="text-sm text-amber-800">
            The following items were received short of the expected quantity.
            For each line, choose whether to expect the remainder from the supplier or to request a credit note.
          </p>
          <div className="mt-1 flex items-center gap-4 text-xs text-amber-700">
            <span>{shortLines.length} short line{shortLines.length !== 1 ? 's' : ''}</span>
            <span>Total short value: R {totalShortValue.toFixed(2)}</span>
          </div>
        </div>

        {/* Lines */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {shortLines.map(line => {
            const expectedQty = parseFloat(line.expected_qty);
            const receivedQty = parseFloat(line.received_qty);
            const shortQty = expectedQty - receivedQty;
            const shortValue = shortQty * (parseFloat(line.unit_cost) || 0);
            const decision = decisions[line.id];

            return (
              <div
                key={line.id}
                className="border border-border rounded-xl p-4 space-y-3"
              >
                {/* Product info */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-semibold">{line.product_name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {line.product_sku} &middot; {line.purchase_uom}
                    </div>
                  </div>
                  <Badge className="bg-amber-100 text-amber-700 text-[10px]">
                    Short {shortQty} {line.purchase_uom}
                  </Badge>
                </div>

                {/* Qty breakdown */}
                <div className="grid grid-cols-4 gap-3 text-center text-xs">
                  <div className="bg-muted/40 rounded-lg p-2">
                    <div className="text-muted-foreground">Expected</div>
                    <div className="font-semibold mt-0.5">{expectedQty}</div>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-2">
                    <div className="text-muted-foreground">Received</div>
                    <div className="font-semibold mt-0.5">{receivedQty}</div>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-2">
                    <div className="text-amber-700">Shortage</div>
                    <div className="font-semibold text-amber-800 mt-0.5">{shortQty}</div>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-2">
                    <div className="text-muted-foreground">Value</div>
                    <div className="font-semibold mt-0.5">R {shortValue.toFixed(2)}</div>
                  </div>
                </div>

                {/* Decision toggle */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setDecision(line.id, 'receive_later')}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      decision === 'receive_later'
                        ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-200'
                        : 'border-border hover:bg-muted/30 text-muted-foreground'
                    }`}
                  >
                    <Clock className="w-4 h-4" />
                    Receive remaining later
                  </button>
                  <button
                    onClick={() => setDecision(line.id, 'request_credit')}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      decision === 'request_credit'
                        ? 'border-amber-500 bg-amber-50 text-amber-700 ring-2 ring-amber-200'
                        : 'border-border hover:bg-muted/30 text-muted-foreground'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                    Request supplier credit
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary + footer */}
        <div className="px-6 py-4 border-t border-border space-y-3">
          {creditCount > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              {creditCount} line{creditCount !== 1 ? 's' : ''} will be added to the Supplier Credits &amp; Returns queue for credit follow-up.
            </p>
          )}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={() => onConfirm(decisions)}
            >
              Confirm Decisions &amp; Finalise GRN
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
