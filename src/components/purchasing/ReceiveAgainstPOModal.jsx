import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { X, Loader2, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';

export default function ReceiveAgainstPOModal({ po, lines, onReceived, onCancel }) {
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

  const { data: products = [] } = useQuery({
    queryKey: ['active-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const linesToReceive = useMemo(() => {
    return lines.filter(l => {
      const qty = Number(receiveQtys[l.id]) || 0;
      return qty > 0;
    });
  }, [lines, receiveQtys]);

  const handleReceive = async () => {
    if (!locationId) { toast.error('Select a receiving location'); return; }
    if (linesToReceive.length === 0) { toast.error('Enter quantities to receive'); return; }
    setReceiving(true);

    const loc = locations.find(l => l.id === locationId);
    const stockRecords = await base44.entities.StockOnHand.list('-updated_date', 2000);

    for (const line of linesToReceive) {
      const qty = Number(receiveQtys[line.id]);
      const product = products.find(p => p.id === line.product_id);
      const stockUom = product?.stock_uom || line.uom || 'pcs';

      // Convert purchase qty to stock qty
      const factor = product?.purchase_to_stock_factor || 1;
      const stockQty = qty * factor;

      // 1. Create stock movement
      await base44.entities.StockMovement.create({
        product_id: line.product_id,
        product_sku: line.product_sku || product?.sku || '',
        product_name: line.product_name || product?.name || '',
        to_location_id: locationId,
        qty: stockQty,
        uom: stockUom,
        reason: 'receipt',
        ref_type: 'purchase_order',
        ref_id: po.id,
        unit_cost_at_movement: line.unit_cost || 0,
        notes: `PO ${po.po_number} — received ${qty} ${line.uom || stockUom}`,
      });

      // 2. Update StockOnHand
      const existing = stockRecords.find(s => s.product_id === line.product_id && s.location_id === locationId);
      if (existing) {
        const newOnHand = (existing.qty_on_hand || 0) + stockQty;
        await base44.entities.StockOnHand.update(existing.id, {
          qty_on_hand: newOnHand,
          qty_available: newOnHand - (existing.qty_committed || 0),
          last_updated_at: new Date().toISOString(),
        });
      } else {
        await base44.entities.StockOnHand.create({
          product_id: line.product_id,
          product_sku: line.product_sku || product?.sku || '',
          product_name: line.product_name || product?.name || '',
          location_id: locationId,
          location_name: loc?.name || '',
          qty_on_hand: stockQty,
          qty_committed: 0,
          qty_available: stockQty,
          uom: stockUom,
          last_updated_at: new Date().toISOString(),
        });
      }

      // 3. Update weighted avg cost
      if (line.unit_cost > 0 && product) {
        const allStock = stockRecords.filter(s => s.product_id === line.product_id);
        const totalExistingQty = allStock.reduce((s, r) => s + (r.qty_on_hand || 0), 0);
        const existingCost = product.cost_avg || 0;
        const totalQty = totalExistingQty + stockQty;
        // Convert unit cost from purchase UoM to stock UoM
        const costPerStockUnit = factor > 0 ? line.unit_cost / factor : line.unit_cost;
        const newAvg = totalQty > 0 ? ((totalExistingQty * existingCost) + (stockQty * costPerStockUnit)) / totalQty : costPerStockUnit;
        await base44.entities.Product.update(product.id, { cost_avg: Math.round(newAvg * 100) / 100 });
      }

      // 4. Update PO line received_qty
      const newReceivedQty = (line.received_qty || 0) + qty;
      await base44.entities.PurchaseOrderLine.update(line.id, { received_qty: newReceivedQty });
    }

    // 5. Update PO status
    const updatedLines = await base44.entities.PurchaseOrderLine.filter({ purchase_order_id: po.id }, 'created_date', 100);
    const allFullyReceived = updatedLines.every(l => (l.received_qty || 0) >= l.ordered_qty);
    const anyReceived = updatedLines.some(l => (l.received_qty || 0) > 0);

    let newStatus = po.status;
    if (allFullyReceived) newStatus = 'received';
    else if (anyReceived) newStatus = 'partially_received';

    if (newStatus !== po.status) {
      await base44.entities.PurchaseOrder.update(po.id, { status: newStatus });
    }

    toast.success(`Received ${linesToReceive.length} items from PO ${po.po_number}`);
    setReceiving(false);
    onReceived();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-xl shadow-xl flex flex-col max-h-[85vh]">
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