import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44, adjustStockOnHand } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  X, RotateCcw, Truck, Calendar, FileText,
  Loader2, CheckCircle2, Package
} from 'lucide-react';
import { toast } from 'sonner';
import { writeAuditLog } from '@/lib/auditLog';

const STATUS_STYLES = {
  pending_return: 'bg-amber-100 text-amber-700',
  returned: 'bg-blue-100 text-blue-700',
  credit_received: 'bg-green-100 text-green-700',
  disputed: 'bg-red-100 text-red-600',
};

const STATUS_LABELS = {
  pending_return: 'Pending Return',
  returned: 'Returned',
  credit_received: 'Credit Received',
  disputed: 'Disputed',
};

const REASON_LABELS = {
  damaged: 'Damaged',
  wrong_item: 'Wrong Item',
  quality_issue: 'Quality Issue',
  expired: 'Expired',
  other: 'Other',
};

export default function ReturnDrawer({ ret, onClose, onUpdated, canProcess }) {
  const queryClient = useQueryClient();
  const [processing, setProcessing] = useState(false);
  const [creditNote, setCreditNote] = useState('');

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['return-lines', ret.id],
    queryFn: () => base44.entities.SupplierReturnLine.filter({ return_id: ret.id }, 'product_name', 100),
  });

  const isPending = ret.status === 'pending_return';

  const handleMarkReturned = async () => {
    setProcessing(true);

    // Create stock OUT movements for returned items
    const grn = await base44.entities.GoodsReceivedNote.filter({ id: ret.grn_id });
    const locationId = grn[0]?.location_id;
    const locationName = grn[0]?.location_name || '';

    for (const line of lines) {
      if (!line.internal_qty_returned || line.internal_qty_returned <= 0) continue;

      // Stock movement OUT for the return
      await base44.entities.StockMovement.create({
        product_id: line.product_id,
        product_sku: line.product_sku || '',
        product_name: line.product_name || '',
        from_location_id: locationId,
        qty: line.internal_qty_returned,
        uom: 'kg', // will be correct for most items
        reason: 'supplier_return',
        ref_type: 'supplier_return',
        ref_id: ret.id,
        ref_number: ret.return_number,
        reference_key: `return:${ret.id}:${line.id}`,
        unit_cost_at_movement: line.return_value / (line.return_qty || 1),
        notes: `Return ${ret.return_number} to ${ret.supplier_name}`,
      });

      // Atomically deduct returned qty from StockOnHand
      if (locationId && line.internal_qty_returned > 0) {
        await adjustStockOnHand(line.product_id, locationId, -line.internal_qty_returned);
      }
    }

    await base44.entities.SupplierReturn.update(ret.id, { status: 'returned' });

    writeAuditLog({
      action: 'process',
      entity_type: 'SupplierReturn',
      entity_id: ret.id,
      description: `Processed return ${ret.return_number} — stock deducted`,
    });

    toast.success('Return processed — stock deducted');
    setProcessing(false);
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    onUpdated?.();
    onClose();
  };

  const handleMarkCreditReceived = async () => {
    setProcessing(true);
    await base44.entities.SupplierReturn.update(ret.id, {
      status: 'credit_received',
      credit_note_number: creditNote,
    });
    writeAuditLog({
      action: 'credit',
      entity_type: 'SupplierReturn',
      entity_id: ret.id,
      description: `Credit received for return ${ret.return_number}: ${creditNote}`,
    });
    toast.success('Credit note recorded');
    setProcessing(false);
    onUpdated?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-card shadow-xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-start justify-between z-10 shrink-0">
          <div>
            <Badge className={`text-[10px] mb-1 ${STATUS_STYLES[ret.status] || ''}`}>
              {STATUS_LABELS[ret.status] || ret.status}
            </Badge>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-red-600" />
              {ret.return_number}
            </h2>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
              <span className="flex items-center gap-1"><Truck className="w-3.5 h-3.5" />{ret.supplier_name}</span>
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{ret.return_date}</span>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        {/* Value summary */}
        <div className="px-6 py-3 border-b border-border bg-muted/30 flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">Total Return Value:</span>
          <span className="font-bold">R {(ret.total_return_value || 0).toFixed(2)}</span>
          {ret.credit_note_number && (
            <span className="text-xs text-muted-foreground">CN: {ret.credit_note_number}</span>
          )}
        </div>

        {/* Lines */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
          ) : lines.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">No return lines.</div>
          ) : (
            <div className="divide-y divide-border">
              {lines.map(line => (
                <div key={line.id} className="px-6 py-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-medium flex items-center gap-2">
                        <Package className="w-4 h-4 text-muted-foreground" />
                        {line.product_name}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 ml-6">
                        {line.product_sku} · {line.return_qty} units · {REASON_LABELS[line.reason] || line.reason}
                      </div>
                      {line.reason_detail && (
                        <div className="text-xs text-muted-foreground ml-6 mt-0.5 italic">{line.reason_detail}</div>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-medium">R {(line.return_value || 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        {ret.notes && (
          <div className="px-6 py-2 border-t border-border">
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {ret.notes}
            </p>
          </div>
        )}

        {/* Actions */}
        {canProcess && (
          <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 shrink-0 space-y-2">
            {isPending && (
              <Button onClick={handleMarkReturned} disabled={processing} className="w-full gap-2">
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {processing ? 'Processing...' : 'Mark as Returned (deduct stock)'}
              </Button>
            )}
            {ret.status === 'returned' && (
              <div className="flex gap-2">
                <Input
                  placeholder="Credit note number..."
                  value={creditNote}
                  onChange={e => setCreditNote(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={handleMarkCreditReceived} disabled={processing || !creditNote} className="gap-1.5">
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Credit Received
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}