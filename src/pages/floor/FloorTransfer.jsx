import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, ArrowRight, Check, Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import FloorZonePicker from '@/components/floor/FloorZonePicker';
import FloorProductSearch from '@/components/floor/FloorProductSearch';
import FloorTransferLines from '@/components/floor/FloorTransferLines';

/**
 * §1E — Floor Transfer
 * Step 1: Pick FROM zone
 * Step 2: Pick TO zone
 * Step 3: Scan/search products → set qty → confirm
 */
export default function FloorTransfer() {
  const queryClient = useQueryClient();
  const [fromZone, setFromZone] = useState(null);
  const [toZone, setToZone] = useState(null);
  const [lines, setLines] = useState([]); // { product, qty }
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ['floor-products-transfer'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
    enabled: !!fromZone && !!toZone,
    staleTime: 5 * 60 * 1000,
  });

  const handleAddProduct = (product) => {
    if (lines.find(l => l.product.id === product.id)) {
      toast('Already added — update the qty below');
      return;
    }
    setLines(prev => [...prev, { product, qty: '' }]);
    toast.success(`Added ${product.name}`);
  };

  const handleQtyChange = (idx, val) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, qty: val } : l));
  };

  const handleRemove = (idx) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
  };

  const validLines = lines.filter(l => Number(l.qty) > 0);

  const handleConfirm = async () => {
    if (validLines.length === 0) { toast.error('Add items with quantities'); return; }
    setSaving(true);

    // Create stock movements
    const movements = validLines.map(line => ({
      product_id: line.product.id,
      product_sku: line.product.sku,
      product_name: line.product.name,
      from_location_id: fromZone.id,
      to_location_id: toZone.id,
      qty: Number(line.qty),
      uom: line.product.stock_uom || 'pcs',
      reason: 'transfer',
      ref_type: 'transfer',
      ref_number: `${fromZone.name} → ${toZone.name}`,
      notes: `Floor transfer: ${fromZone.name} → ${toZone.name}`,
    }));
    await base44.entities.StockMovement.bulkCreate(movements);

    // Update StockOnHand
    const stockRecords = await base44.entities.StockOnHand.list('-updated_date', 2000);
    for (const line of validLines) {
      const qty = Number(line.qty);

      // Decrement from
      const fromStock = stockRecords.find(s => s.product_id === line.product.id && s.location_id === fromZone.id);
      if (fromStock) {
        const newOnHand = Math.max(0, (fromStock.qty_on_hand || 0) - qty);
        await base44.entities.StockOnHand.update(fromStock.id, {
          qty_on_hand: newOnHand,
          qty_available: newOnHand - (fromStock.qty_committed || 0),
          last_updated_at: new Date().toISOString(),
        });
      }

      // Increment to
      const toStock = stockRecords.find(s => s.product_id === line.product.id && s.location_id === toZone.id);
      if (toStock) {
        const newOnHand = (toStock.qty_on_hand || 0) + qty;
        await base44.entities.StockOnHand.update(toStock.id, {
          qty_on_hand: newOnHand,
          qty_available: newOnHand - (toStock.qty_committed || 0),
          last_updated_at: new Date().toISOString(),
        });
      } else {
        await base44.entities.StockOnHand.create({
          product_id: line.product.id,
          product_sku: line.product.sku,
          product_name: line.product.name,
          location_id: toZone.id,
          location_name: toZone.name,
          qty_on_hand: qty,
          qty_committed: 0,
          qty_available: qty,
          uom: line.product.stock_uom || 'pcs',
          last_updated_at: new Date().toISOString(),
        });
      }
    }

    queryClient.invalidateQueries({ queryKey: ['floor-stock'] });
    toast.success(`${validLines.length} items transferred: ${fromZone.name} → ${toZone.name}`);
    setDone(true);
    setSaving(false);
  };

  // Done screen
  if (done) {
    return (
      <div className="space-y-4">
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-6 text-center">
          <Check className="w-10 h-10 text-green-600 mx-auto mb-2" />
          <p className="font-semibold text-green-800 dark:text-green-300">Transfer Complete</p>
          <p className="text-sm text-green-600 dark:text-green-400">
            {validLines.length} items moved from {fromZone.name} → {toZone.name}
          </p>
        </div>
        <Button className="w-full h-12" onClick={() => { setFromZone(null); setToZone(null); setLines([]); setDone(false); }}>
          New Transfer
        </Button>
      </div>
    );
  }

  // Step 1: FROM zone
  if (!fromZone) {
    return <FloorZonePicker title="Transfer Stock" subtitle="Select source zone" onSelect={setFromZone} />;
  }

  // Step 2: TO zone
  if (!toZone) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setFromZone(null)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <p className="text-xs text-muted-foreground">From: <strong>{fromZone.name}</strong></p>
          </div>
        </div>
        <FloorZonePicker title="Select Destination" subtitle="Where should the stock go?" onSelect={setToZone} excludeId={fromZone.id} />
      </div>
    );
  }

  // Step 3: Add items
  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => { setToZone(null); setLines([]); }}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2 text-sm flex-1 min-w-0">
          <Badge variant="outline" className="shrink-0">{fromZone.code}</Badge>
          <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
          <Badge variant="outline" className="shrink-0">{toZone.code}</Badge>
        </div>
      </div>

      <FloorProductSearch products={products} onSelect={handleAddProduct} placeholder="Scan or search item to transfer..." />

      <FloorTransferLines lines={lines} onQtyChange={handleQtyChange} onRemove={handleRemove} />

      {/* Sticky confirm bar */}
      <div className="fixed bottom-[68px] left-0 right-0 bg-card/95 backdrop-blur border-t border-border px-4 py-3 z-30">
        <Button
          onClick={handleConfirm}
          disabled={saving || validLines.length === 0}
          className="w-full h-12 text-base gap-2"
          size="lg"
        >
          <Send className="w-5 h-5" />
          {saving ? 'Transferring...' : `Confirm Transfer (${validLines.length})`}
        </Button>
      </div>
    </div>
  );
}