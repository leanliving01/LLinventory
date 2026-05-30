import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { X, Loader2, PackageCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { confirmGRN, finaliseGRNWithDecisions } from '@/components/grn/GRNConfirmLogic';
import { nextDocNumber } from '@/lib/docNumbering';

export default function ReceiveAgainstPOModal({ po, lines, onReceived, onCancel }) {
  const { user } = useAuth();
  const [receiving, setReceiving] = useState(false);
  const [locationId, setLocationId] = useState(po.location_id || '');
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().split('T')[0]);
  const [receiveQtys, setReceiveQtys] = useState(() => {
    const init = {};
    lines.forEach(l => {
      const remaining = l.ordered_qty - (l.received_qty || 0);
      init[l.id] = remaining > 0 ? String(remaining) : '0';
    });
    return init;
  });

  // Shortage decision step
  const [pendingDecision, setPendingDecision] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [expectedDates, setExpectedDates] = useState({});

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 50),
  });

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

  const handleReceive = async () => {
    if (!locationId) { toast.error('Select a receiving location'); return; }
    if (linesToReceive.length === 0) { toast.error('Enter quantities to receive'); return; }
    setReceiving(true);

    try {
      const loc = locations.find(l => l.id === locationId);
      const grnNumber = await nextDocNumber('GRN');

      const grn = await base44.entities.GoodsReceivedNote.create({
        grn_number: grnNumber,
        purchase_order_id: po.id,
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name,
        location_id: locationId || null,
        location_name: loc?.name || '',
        received_date: receivedDate,
        status: 'draft',
        total_lines: linesToReceive.length,
      });

      const grnLines = linesToReceive.map(l => {
        const sp = spByProductId[l.product_id];
        return {
          grn_id: grn.id,
          po_line_id: l.id,
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

      const result = await confirmGRN(grn, grnLines, user?.full_name || 'Unknown');

      // Always update PO line received_qtys — stock was physically received regardless of shortages
      for (const l of linesToReceive) {
        const newReceivedQty = (l.received_qty || 0) + Number(receiveQtys[l.id]);
        await base44.entities.PurchaseOrderLine.update(l.id, { received_qty: newReceivedQty });
      }

      if (result.requiresDecision) {
        // Shortage detected — show per-line decision step before finalising
        const initDecisions = {};
        result.shortLines.forEach(l => { initDecisions[l.id] = 'receive_later'; });
        setPendingDecision(result);
        setDecisions(initDecisions);
        setReceiving(false);
        return;
      }

      // No shortages — correct PO status for partial receipt
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

  const handleFinalise = async () => {
    setReceiving(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(decisions).map(([id, action]) => [
          id,
          { action, expected_delivery_date: action === 'receive_later' ? (expectedDates[id] || null) : null },
        ])
      );
      await finaliseGRNWithDecisions(
        pendingDecision.grn,
        pendingDecision.persistedLines,
        payload,
        user?.full_name || 'Unknown'
      );
      toast.success(`GRN ${pendingDecision.grn.grn_number} confirmed`);
      onReceived();
    } catch (err) {
      toast.error('Failed to finalise GRN: ' + (err?.message || 'Unknown error'));
    } finally {
      setReceiving(false);
    }
  };

  const title = pendingDecision ? 'Handle Shortages' : `Receive Against ${po.po_number}`;

  return (
    <>
    <div className="fixed inset-0 bg-black/50 z-40" />
    <div className="fixed inset-0 z-50 flex items-stretch justify-center">
      <div className="bg-card w-full max-w-4xl shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-lg font-bold">{title}</h3>
            <p className="text-sm text-muted-foreground">{po.supplier_name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {pendingDecision ? (
            /* ── Shortage decision step ── */
            <>
              <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">Some items were short-received</p>
                  <p className="text-xs text-amber-700 mt-0.5">Choose how to handle each shortage below, then click Finalise GRN.</p>
                </div>
              </div>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Expected</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Received</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Short</th>
                      <th className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pendingDecision.shortLines.map(l => {
                      const short = parseFloat(l.expected_qty) - parseFloat(l.received_qty);
                      return (
                        <tr key={l.id}>
                          <td className="px-3 py-2">
                            <p className="text-xs font-medium">{l.product_name}</p>
                            <p className="text-[10px] font-mono text-muted-foreground">{l.product_sku}</p>
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-muted-foreground">{l.expected_qty}</td>
                          <td className="px-3 py-2 text-right text-xs">{l.received_qty}</td>
                          <td className="px-3 py-2 text-right text-xs font-semibold text-amber-600">{short}</td>
                          <td className="px-3 py-2 min-w-[200px]">
                            <Select
                              value={decisions[l.id] || 'receive_later'}
                              onValueChange={val => setDecisions(prev => ({ ...prev, [l.id]: val }))}
                            >
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="receive_later">Wait for delivery</SelectItem>
                                <SelectItem value="request_credit">Request credit note</SelectItem>
                              </SelectContent>
                            </Select>
                            {(decisions[l.id] || 'receive_later') === 'receive_later' && (
                              <div className="mt-1.5">
                                <label className="text-[10px] text-muted-foreground">Expected next delivery</label>
                                <Input
                                  type="date"
                                  value={expectedDates[l.id] || ''}
                                  onChange={e => setExpectedDates(prev => ({ ...prev, [l.id]: e.target.value }))}
                                  className="h-8 text-xs mt-0.5"
                                />
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                <strong>Wait for delivery</strong> — PO stays open; you can create another GRN when the remaining stock arrives.<br />
                <strong>Request credit note</strong> — raises a supplier shortage record; the PO moves to credit-note pending.
              </p>
            </>
          ) : (
            /* ── Normal receive form ── */
            <>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Receive Into *</label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select location..." /></SelectTrigger>
                  <SelectContent>
                    {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Received Date *</label>
                <Input
                  type="date"
                  value={receivedDate}
                  onChange={e => setReceivedDate(e.target.value)}
                  className="mt-1"
                />
              </div>

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
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border shrink-0 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          {pendingDecision ? (
            <Button className="flex-1 gap-2" onClick={handleFinalise} disabled={receiving}>
              {receiving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {receiving ? 'Finalising...' : 'Finalise GRN'}
            </Button>
          ) : (
            <Button className="flex-1 gap-2 bg-green-600 hover:bg-green-700" onClick={handleReceive} disabled={receiving || linesToReceive.length === 0}>
              {receiving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
              {receiving ? 'Receiving...' : `Receive ${linesToReceive.length} Items`}
            </Button>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
