import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { X, Receipt, Truck, MapPin, Calendar, FileText, CheckCircle2, Loader2, Ban, Package } from 'lucide-react';
import { toast } from 'sonner';
import ReceiveAgainstPOModal from './ReceiveAgainstPOModal';

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-blue-100 text-blue-700',
  partially_received: 'bg-amber-100 text-amber-700',
  received: 'bg-green-100 text-green-700',
  invoiced: 'bg-purple-100 text-purple-700',
  paid: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

export default function PODetailDrawer({ po, onClose, onUpdated }) {
  const queryClient = useQueryClient();
  const [updating, setUpdating] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState(po.supplier_invoice_number || '');

  const { data: lines = [] } = useQuery({
    queryKey: ['po-lines', po.id],
    queryFn: () => base44.entities.PurchaseOrderLine.filter({ purchase_order_id: po.id }, 'created_date', 100),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 50),
  });

  const location = useMemo(() => locations.find(l => l.id === po.location_id), [locations, po.location_id]);

  const allReceived = lines.length > 0 && lines.every(l => (l.received_qty || 0) >= l.ordered_qty);

  const handleConfirm = async () => {
    setUpdating(true);
    await base44.entities.PurchaseOrder.update(po.id, { status: 'confirmed' });
    toast.success('PO confirmed');
    setUpdating(false);
    onUpdated();
  };

  const handleCancel = async () => {
    setUpdating(true);
    await base44.entities.PurchaseOrder.update(po.id, { status: 'cancelled' });
    toast.success('PO cancelled');
    setUpdating(false);
    onUpdated();
  };

  const handleMarkInvoiced = async () => {
    setUpdating(true);
    await base44.entities.PurchaseOrder.update(po.id, {
      status: 'invoiced',
      supplier_invoice_number: invoiceNumber || null,
    });
    toast.success('PO marked as invoiced');
    setUpdating(false);
    onUpdated();
  };

  const handleMarkPaid = async () => {
    setUpdating(true);
    await base44.entities.PurchaseOrder.update(po.id, { status: 'paid', payment_status: 'paid' });
    toast.success('PO marked as paid');
    setUpdating(false);
    onUpdated();
  };

  const handleReceived = () => {
    setShowReceive(false);
    queryClient.invalidateQueries({ queryKey: ['po-lines', po.id] });
    onUpdated();
  };

  // Actions available based on status
  const canConfirm = po.status === 'draft';
  const canReceive = ['confirmed', 'partially_received'].includes(po.status);
  const canInvoice = ['received'].includes(po.status);
  const canPay = ['invoiced'].includes(po.status);
  const canCancel = ['draft', 'confirmed'].includes(po.status);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-card shadow-xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-start justify-between z-10 shrink-0">
          <div>
            <Badge className={`text-[10px] mb-1 ${STATUS_COLORS[po.status]}`}>{po.status?.replace('_', ' ')}</Badge>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Receipt className="w-5 h-5 text-primary" />
              {po.po_number}
            </h2>
            <p className="text-sm text-muted-foreground">{po.supplier_name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Info row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-start gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase font-semibold">Order Date</p>
                <p className="text-sm">{po.order_date || '—'}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase font-semibold">Expected</p>
                <p className="text-sm">{po.expected_date || '—'}</p>
              </div>
            </div>
            {location && (
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Deliver To</p>
                  <p className="text-sm">{location.name}</p>
                </div>
              </div>
            )}
            {po.notes && (
              <div className="flex items-start gap-2">
                <FileText className="w-4 h-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Notes</p>
                  <p className="text-sm">{po.notes}</p>
                </div>
              </div>
            )}
          </div>

          {/* Line items */}
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <Package className="w-4 h-4 text-primary" />
              Line Items ({lines.length})
            </h3>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Ordered</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Received</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Cost</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map(l => {
                    const pct = l.ordered_qty > 0 ? Math.round((l.received_qty || 0) / l.ordered_qty * 100) : 0;
                    return (
                      <tr key={l.id}>
                        <td className="px-3 py-2">
                          <p className="text-xs font-medium">{l.product_name}</p>
                          <p className="text-[10px] font-mono text-muted-foreground">{l.product_sku} · {l.uom}</p>
                        </td>
                        <td className="px-3 py-2 text-right text-xs">{l.ordered_qty}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={`text-xs font-medium ${pct >= 100 ? 'text-green-600' : pct > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                            {l.received_qty || 0}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-muted-foreground">R {(l.unit_cost || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right text-xs font-medium">R {(l.line_total || 0).toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>R {(po.subtotal || 0).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">VAT (15%)</span><span>R {(po.tax || 0).toFixed(2)}</span></div>
            <div className="flex justify-between font-bold text-base pt-1 border-t border-border"><span>Total</span><span>R {(po.total || 0).toFixed(2)}</span></div>
          </div>

          {/* Invoice number for invoiced/paid */}
          {(canInvoice || po.status === 'invoiced' || po.status === 'paid') && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier Invoice #</label>
              <Input
                value={invoiceNumber}
                onChange={e => setInvoiceNumber(e.target.value)}
                placeholder="INV-12345"
                className="mt-1"
                disabled={po.status === 'paid'}
              />
            </div>
          )}
        </div>

        {/* Action footer */}
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 shrink-0 flex gap-2 flex-wrap">
          {canCancel && (
            <Button variant="outline" size="sm" onClick={handleCancel} disabled={updating} className="gap-1 text-destructive hover:text-destructive">
              <Ban className="w-3.5 h-3.5" /> Cancel PO
            </Button>
          )}
          <div className="flex-1" />
          {canConfirm && (
            <Button size="sm" onClick={handleConfirm} disabled={updating} className="gap-1">
              {updating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Confirm
            </Button>
          )}
          {canReceive && (
            <Button size="sm" onClick={() => setShowReceive(true)} className="gap-1 bg-green-600 hover:bg-green-700">
              <Truck className="w-3.5 h-3.5" /> Receive Stock
            </Button>
          )}
          {canInvoice && (
            <Button size="sm" onClick={handleMarkInvoiced} disabled={updating} className="gap-1 bg-purple-600 hover:bg-purple-700">
              <FileText className="w-3.5 h-3.5" /> Mark Invoiced
            </Button>
          )}
          {canPay && (
            <Button size="sm" onClick={handleMarkPaid} disabled={updating} className="gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Mark Paid
            </Button>
          )}
        </div>
      </div>

      {showReceive && (
        <ReceiveAgainstPOModal
          po={po}
          lines={lines}
          onReceived={handleReceived}
          onCancel={() => setShowReceive(false)}
        />
      )}
    </div>
  );
}