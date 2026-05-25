import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { X, Loader2, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { confirmGRN } from '@/components/grn/GRNConfirmLogic';

export default function ReceiveAgainstPOModal({ po, lines, onReceived, onCancel }) {
  const { user } = useAuth();
  const [receiving, setReceiving] = useState(false);
  const [locationId, setLocationId] = useState(po.location_id || '');
  const [receiveQtys, setReceiveQtys] = useState(() => {
    const init = {};
    lines.forEach(l => {
      const remaining = l.ordered_qty - (l.received_qty || 0);
      init[l.id] = remaining > 0 ? String(remaining) : '0';
    });
    return init;
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 50),
  });

  // Fetch supplier products to get conversion/yield factors for accurate stock qty calculation
  const { data: supplierProducts = [] } = useQuery({
    queryKey: ['supplier-products-for-grn', po.supplier_id],
    queryFn: () => base44.entities.SupplierProduct.filter({ supplier_id: po.supplier_id, active: true }, 'product_name', 200),
    enabled: !!po.supplier_id,
  });

  const spByProductId = useMemo(() => {
    const m = {};
    supplierProducts.forEach(sp => { m[sp.product_id] = sp; });
    return m;
  }, [supplierProducts]);

  const linesToReceive = useMemo(() => {
    return lines.filter(l => (Number(receiveQtys[l.id]) || 0) > 0);
  }, [lines, receiveQtys]);

  const generateGRNNumber = async () => {
    const today = new Date().toISOString().split('T')[0];
    const existing = await base44.entities.GoodsReceivedNote.list('-created_date', 1);
    const lastNum = existing.length > 0
      ? parseInt((existing[0].grn_number || '').split('-').pop() || '0', 10)
      : 0;
    return `GRN-${today}-${String(lastNum + 1).padStart(3, '0')}`;
  };

  const handleReceive = async () => {
    if (!locationId) { toast.error('Select a receiving location'); return; }
    if (linesToReceive.length === 0) { toast.error('Enter quantities to receive'); return; }
    setReceiving(true);

    try {
      const loc = locations.find(l => l.id === locationId);
      const today = new Date().toISOString().split('T')[0];
      const grnNumber = await generateGRNNumber();

      // Create the GRN record (draft — confirmGRN will mark it confirmed)
      const grn = await base44.entities.GoodsReceivedNote.create({
        grn_number: grnNumber,
        purchase_order_id: po.id,
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name,
        location_id: locationId || null,
        location_name: loc?.name || '',
        received_date: today,
        status: 'draft',
        total_lines: linesToReceive.length,
      });

      // Map PO lines to GRN line format — confirmGRN will create the GRNLine records
      const grnLines = linesToReceive.map(l => {
        const sp = spByProductId[l.product_id];
        return {
          grn_id: grn.id,
          product_id: l.product_id,
          product_name: l.product_name || '',
          product_sku: l.product_sku || '',
          expected_qty: l.ordered_qty - (l.received_qty || 0),
          received_qty: Number(receiveQtys[l.id]),
          unit_cost: l.unit_cost || 0,
          purchase_uom: l.uom || sp?.purchase_uom || '',
          conversion_factor: sp?.conversion_factor || 1,
          yield_factor: sp?.yield_factor || 1,
          condition: 'accepted',
          item_type: 'stock',
          supplier_product_id: sp?.id || null,
        };
      });

      // Run the standard GRN confirmation flow:
      // creates GRNLines, StockMovements, updates StockOnHand, writes price history, creates shortages
      await confirmGRN(grn, grnLines, user?.full_name || 'Unknown');

      // Update PO line received_qtys (confirmGRN tracks GRN lines, not PO lines)
      for (const l of linesToReceive) {
        const newReceivedQty = (l.received_qty || 0) + Number(receiveQtys[l.id]);
        await base44.entities.PurchaseOrderLine.update(l.id, { received_qty: newReceivedQty });
      }

      // Correct PO status for partial receipt — confirmGRN always sets 'received', but we
      // need 'partially_received' when some lines are still outstanding
      const allLines = await base44.entities.PurchaseOrderLine.filter({ purchase_order_id: po.id }, 'created_date', 100);
      const allFullyReceived = allLines.every(l => (l.received_qty || 0) >= l.ordered_qty);
      const anyReceived = allLines.some(l => (l.received_qty || 0) > 0);
      if (!allFullyReceived && anyReceived) {
        await base44.entities.PurchaseOrder.update(po.id, { status: 'partially_received' });
      }

      toast.success(`GRN ${grnNumber} created — ${linesToReceive.length} item${linesToReceive.length !== 1 ? 's' : ''} received`);
      onReceived();
    } catch (err) {
      toast.error('Failed to receive stock: ' + (err?.message || 'Unknown error'));
    } finally {
      setReceiving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-stretch justify-center">
      <div className="bg-card w-full max-w-4xl shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-lg font-bold">Receive Against {po.po_number}</h3>
            <p className="text-sm text-muted-foreground">{po.supplier_name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Location */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Receive Into *</label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select location..." /></SelectTrigger>
              <SelectContent>
                {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Lines */}
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Ordered</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Already</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Receiving</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map(l => {
                  const remaining = l.ordered_qty - (l.received_qty || 0);
                  const done = remaining <= 0;
                  return (
                    <tr key={l.id} className={done ? 'opacity-50' : ''}>
                      <td className="px-3 py-2">
                        <p className="text-xs font-medium">{l.product_name}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">{l.product_sku}</p>
                      </td>
                      <td className="px-3 py-2 text-right text-xs">{l.ordered_qty}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={`text-xs ${done ? 'text-green-600 font-medium' : 'text-muted-foreground'}`}>{l.received_qty || 0}</span>
                      </td>
                      <td className="px-3 py-2">
                        {done ? (
                          <Badge className="text-[10px] bg-green-100 text-green-700 float-right">Done</Badge>
                        ) : (
                          <Input
                            type="number"
                            value={receiveQtys[l.id] || ''}
                            onChange={e => setReceiveQtys(prev => ({ ...prev, [l.id]: e.target.value }))}
                            className="h-8 text-xs text-right w-full"
                            min="0"
                            max={remaining}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border shrink-0 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1 gap-2 bg-green-600 hover:bg-green-700" onClick={handleReceive} disabled={receiving || linesToReceive.length === 0}>
            {receiving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
            {receiving ? 'Receiving...' : `Receive ${linesToReceive.length} Items`}
          </Button>
        </div>
      </div>
    </div>
  );
}
