import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, Check, Truck, PackageCheck, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import FloorZonePicker from '@/components/floor/FloorZonePicker';
import FloorProductSearch from '@/components/floor/FloorProductSearch';
import FloorReceiveLines from '@/components/floor/FloorReceiveLines';
import { useUnsavedChanges } from '@/lib/navigationGuard';

/**
 * §1F — Floor Receive
 * Step 1: Pick receiving zone
 * Step 2: Optionally select a PO (auto-populates lines)
 * Step 3: Scan/search products, enter qty + cost → confirm
 */
export default function FloorReceive() {
  const queryClient = useQueryClient();
  const [zone, setZone] = useState(null);
  const [selectedPO, setSelectedPO] = useState(null);
  const [lines, setLines] = useState([]); // { product, qty, unit_cost }
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const { data: openPOs = [], isLoading: loadingPOs } = useQuery({
    queryKey: ['open-pos-floor'],
    queryFn: async () => {
      const confirmed = await base44.entities.PurchaseOrder.filter({ status: 'confirmed' }, '-order_date', 20);
      const partial = await base44.entities.PurchaseOrder.filter({ status: 'partially_received' }, '-order_date', 20);
      return [...confirmed, ...partial];
    },
    enabled: !!zone && !selectedPO,
    staleTime: 60 * 1000,
  });

  const { data: poLines = [] } = useQuery({
    queryKey: ['po-lines', selectedPO?.id],
    queryFn: () => base44.entities.PurchaseOrderLine.filter({ purchase_order_id: selectedPO.id }, 'product_name', 100),
    enabled: !!selectedPO && selectedPO.id !== '_adhoc',
  });

  const { data: products = [] } = useQuery({
    queryKey: ['floor-products-receive'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
    enabled: !!zone,
    staleTime: 5 * 60 * 1000,
  });

  const productMap = useMemo(() => {
    const map = {};
    products.forEach(p => { map[p.id] = p; });
    return map;
  }, [products]);

  // When PO is selected, pre-populate lines from PO lines
  const handleSelectPO = (po) => {
    setSelectedPO(po);
  };

  // Once PO lines load, populate
  useEffect(() => {
    if (selectedPO && poLines.length > 0) {
      const newLines = poLines
        .filter(pl => {
          const remaining = (pl.ordered_qty || 0) - (pl.received_qty || 0);
          return remaining > 0;
        })
        .map(pl => {
          const product = productMap[pl.product_id] || {
            id: pl.product_id,
            name: pl.product_name || '',
            sku: pl.product_sku || '',
            stock_uom: pl.uom || 'pcs',
          };
          const remaining = (pl.ordered_qty || 0) - (pl.received_qty || 0);
          return {
            product,
            qty: String(remaining),
            unit_cost: String(pl.unit_cost || ''),
            po_line_id: pl.id,
            ordered_qty: pl.ordered_qty,
            received_qty: pl.received_qty || 0,
          };
        });
      setLines(newLines);
    }
  }, [selectedPO, poLines, productMap]);

  const handleAddProduct = (product) => {
    if (lines.find(l => l.product.id === product.id)) {
      toast('Already added — update the qty below');
      return;
    }
    setLines(prev => [...prev, { product, qty: '', unit_cost: String(product.cost_avg || '') }]);
    toast.success(`Added ${product.name}`);
  };

  const handleQtyChange = (idx, val) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, qty: val } : l));
  };

  const handleCostChange = (idx, val) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, unit_cost: val } : l));
  };

  const handleRemove = (idx) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
  };

  const validLines = lines.filter(l => Number(l.qty) > 0);

  // Unsaved-draft guard: a receipt being built (lines added, not yet confirmed)
  // lives only in memory until handleConfirm. Auto-save is not in play here.
  useUnsavedChanges(lines.length > 0 && !done && !saving, {
    message: 'This receipt has unconfirmed items that will be lost if you leave.',
  });

  const handleConfirm = async () => {
    if (validLines.length === 0) { toast.error('Add items with quantities'); return; }
    setSaving(true);

    try {
      // 1. Create receipt stock movements
      const movements = validLines.map(line => ({
        product_id: line.product.id,
        product_sku: line.product.sku || '',
        product_name: line.product.name || '',
        to_location_id: zone.id,
        qty: Number(line.qty),
        uom: line.product.stock_uom || 'pcs',
        reason: 'receipt',
        unit_cost_at_movement: Number(line.unit_cost) || 0,
        ref_type: selectedPO && selectedPO.id !== '_adhoc' ? 'purchase_order' : 'manual',
        ref_id: selectedPO && selectedPO.id !== '_adhoc' ? selectedPO.id : undefined,
        ref_number: selectedPO ? `PO ${selectedPO.po_number}` : `Receipt to ${zone.name}`,
        notes: `Floor receive into ${zone.name}${selectedPO ? ` (PO ${selectedPO.po_number})` : ''}`,
      }));
      await base44.entities.StockMovement.bulkCreate(movements);

      // 2. Update StockOnHand
      const stockRecords = await base44.entities.StockOnHand.list('-updated_date', 2000);
      for (const line of validLines) {
        const qty = Number(line.qty);
        const existing = stockRecords.find(s => s.product_id === line.product.id && s.location_id === zone.id);
        if (existing) {
          const newOnHand = (existing.qty_on_hand || 0) + qty;
          await base44.entities.StockOnHand.update(existing.id, {
            qty_on_hand: newOnHand,
            qty_available: newOnHand - (existing.qty_committed || 0),
            last_updated_at: new Date().toISOString(),
          });
        } else {
          await base44.entities.StockOnHand.create({
            product_id: line.product.id,
            product_sku: line.product.sku || '',
            product_name: line.product.name || '',
            location_id: zone.id,
            location_name: zone.name,
            qty_on_hand: qty,
            qty_committed: 0,
            qty_available: qty,
            uom: line.product.stock_uom || 'pcs',
            last_updated_at: new Date().toISOString(),
          });
        }

        // 3. Update cost_avg (weighted average)
        const unitCost = Number(line.unit_cost);
        if (unitCost > 0) {
          const product = productMap[line.product.id];
          if (product) {
            const allStock = stockRecords.filter(s => s.product_id === line.product.id);
            const totalExisting = allStock.reduce((s, r) => s + (r.qty_on_hand || 0), 0);
            const existingCost = product.cost_avg || 0;
            const totalQty = totalExisting + qty;
            const newAvg = totalQty > 0 ? ((totalExisting * existingCost) + (qty * unitCost)) / totalQty : unitCost;
            await base44.entities.Product.update(product.id, { cost_avg: Math.round(newAvg * 100) / 100 });
          }
        }
      }

      // 4. Update PO line received_qty and PO status
      if (selectedPO && selectedPO.id !== '_adhoc') {
        for (const line of validLines) {
          if (line.po_line_id) {
            const poLine = poLines.find(pl => pl.id === line.po_line_id);
            if (poLine) {
              const newReceived = (poLine.received_qty || 0) + Number(line.qty);
              await base44.entities.PurchaseOrderLine.update(poLine.id, { received_qty: newReceived });
            }
          }
        }
        // Check if all lines fully received
        const updatedLines = await base44.entities.PurchaseOrderLine.filter({ purchase_order_id: selectedPO.id }, 'product_name', 100);
        const allFullyReceived = updatedLines.every(pl => (pl.received_qty || 0) >= (pl.ordered_qty || 0));
        await base44.entities.PurchaseOrder.update(selectedPO.id, {
          status: allFullyReceived ? 'received' : 'partially_received',
        });
      }

      queryClient.invalidateQueries({ queryKey: ['floor-stock'] });
      queryClient.invalidateQueries({ queryKey: ['open-pos-floor'] });
      toast.success(`${validLines.length} items received into ${zone.name}`);
      setDone(true);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // Done screen
  if (done) {
    return (
      <div className="space-y-4">
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-6 text-center">
          <Check className="w-10 h-10 text-green-600 mx-auto mb-2" />
          <p className="font-semibold text-green-800 dark:text-green-300">Receipt Complete</p>
          <p className="text-sm text-green-600 dark:text-green-400">
            {validLines.length} items into {zone.name}
            {selectedPO && ` (PO ${selectedPO.po_number})`}
          </p>
        </div>
        <Button className="w-full h-12" onClick={() => { setZone(null); setSelectedPO(null); setLines([]); setDone(false); }}>
          Receive More
        </Button>
      </div>
    );
  }

  // Step 1: Zone picker
  if (!zone) {
    return <FloorZonePicker title="Receive Stock" subtitle="Select receiving zone" onSelect={setZone} />;
  }

  // Step 2: PO selection or skip
  if (!selectedPO && lines.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setZone(null)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-bold">Receive into {zone.name}</h1>
            <p className="text-xs text-muted-foreground">Select a PO or receive without one</p>
          </div>
        </div>

        <Button
          variant="outline"
          className="w-full h-14 text-base justify-start gap-3 border-2"
          onClick={() => setSelectedPO({ id: '_adhoc', po_number: 'Ad-hoc' })}
        >
          <PackageCheck className="w-6 h-6 text-muted-foreground" />
          <div className="text-left">
            <p className="font-semibold text-sm">Receive Without PO</p>
            <p className="text-xs text-muted-foreground">Ad-hoc receipt — scan items manually</p>
          </div>
        </Button>

        {loadingPOs ? (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading POs...
          </div>
        ) : openPOs.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Open Purchase Orders</p>
            {openPOs.map(po => (
              <button
                key={po.id}
                onClick={() => handleSelectPO(po)}
                className="w-full bg-card border-2 border-border rounded-2xl p-4 flex items-center gap-3 active:scale-[0.98] transition-transform text-left hover:border-primary/40"
              >
                <div className="w-11 h-11 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                  <Truck className="w-5 h-5 text-orange-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">{po.po_number}</p>
                  <p className="text-xs text-muted-foreground truncate">{po.supplier_name || 'Unknown supplier'}</p>
                </div>
                <Badge variant="outline" className="text-xs shrink-0">{po.status}</Badge>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">No open purchase orders</p>
        )}
      </div>
    );
  }

  // Step 3: Line items
  const isAdhoc = selectedPO?.id === '_adhoc';

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => { setSelectedPO(null); setLines([]); }}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate">
            {isAdhoc ? 'Ad-hoc Receipt' : `PO ${selectedPO.po_number}`}
          </h1>
          <p className="text-xs text-muted-foreground">Into: {zone.name}</p>
        </div>
      </div>

      <FloorProductSearch products={products} onSelect={handleAddProduct} placeholder="Scan or search item to receive..." />

      <FloorReceiveLines
        lines={lines}
        onQtyChange={handleQtyChange}
        onCostChange={handleCostChange}
        onRemove={handleRemove}
      />

      {/* Sticky confirm bar */}
      <div className="fixed bottom-[68px] left-0 right-0 bg-card/95 backdrop-blur border-t border-border px-4 py-3 z-30">
        <Button
          onClick={handleConfirm}
          disabled={saving || validLines.length === 0}
          className="w-full h-12 text-base gap-2"
          size="lg"
        >
          <PackageCheck className="w-5 h-5" />
          {saving ? 'Receiving...' : `Confirm Receipt (${validLines.length})`}
        </Button>
      </div>
    </div>
  );
}