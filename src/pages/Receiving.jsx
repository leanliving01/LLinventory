import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, PackageCheck, Search } from 'lucide-react';
import { toast } from 'sonner';
import HelpDrawer from '@/components/help/HelpDrawer';
import { writeAuditLog } from '@/lib/auditLog';

export default function Receiving() {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [lines, setLines] = useState([{ product_id: '', qty: '', unit_cost: '' }]);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => base44.entities.Supplier.filter({ status: 'active' }, 'name', 100),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 50),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['active-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  // Filter products by supplier if selected
  const supplierProducts = useMemo(() => {
    let list = products;
    if (supplierId) {
      const supplierFiltered = products.filter(p => p.supplier_id === supplierId);
      if (supplierFiltered.length > 0) list = supplierFiltered;
    }
    if (!search) return list.slice(0, 15);
    const s = search.toLowerCase();
    return list.filter(p => p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s)).slice(0, 15);
  }, [products, supplierId, search]);

  const addLine = () => setLines(prev => [...prev, { product_id: '', qty: '', unit_cost: '' }]);
  const removeLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx));
  const updateLine = (idx, field, value) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const validLines = lines.filter(l => l.product_id && Number(l.qty) > 0);

  const handleReceive = async () => {
    if (!locationId) { toast.error('Select a receiving location'); return; }
    if (validLines.length === 0) { toast.error('Add at least one product with quantity'); return; }

    setSaving(true);
    const loc = locations.find(l => l.id === locationId);

    // 1. Create receipt stock movements
    const supplierName = supplierId ? suppliers.find(s => s.id === supplierId)?.name || '' : '';
    const movements = validLines.map(line => {
      const product = products.find(p => p.id === line.product_id);
      return {
        product_id: line.product_id,
        product_sku: product?.sku || '',
        product_name: product?.name || '',
        to_location_id: locationId,
        qty: Number(line.qty),
        uom: product?.stock_uom || 'pcs',
        reason: 'receipt',
        ref_type: 'manual',
        ref_number: supplierName ? `Receipt from ${supplierName}` : `Receipt to ${loc?.name}`,
        unit_cost_at_movement: Number(line.unit_cost) || product?.cost_avg || 0,
        notes: `Receipt to ${loc?.name}${supplierName ? ` from ${supplierName}` : ''}`,
      };
    });

    await base44.entities.StockMovement.bulkCreate(movements);

    // 2. Update StockOnHand
    const stockRecords = await base44.entities.StockOnHand.list('-updated_date', 2000);
    for (const line of validLines) {
      const qty = Number(line.qty);
      const product = products.find(p => p.id === line.product_id);
      const existing = stockRecords.find(s => s.product_id === line.product_id && s.location_id === locationId);

      if (existing) {
        const newOnHand = (existing.qty_on_hand || 0) + qty;
        await base44.entities.StockOnHand.update(existing.id, {
          qty_on_hand: newOnHand,
          qty_available: newOnHand - (existing.qty_committed || 0),
          last_updated_at: new Date().toISOString(),
        });
      } else {
        await base44.entities.StockOnHand.create({
          product_id: line.product_id,
          product_sku: product?.sku || '',
          product_name: product?.name || '',
          location_id: locationId,
          location_name: loc?.name || '',
          qty_on_hand: qty,
          qty_committed: 0,
          qty_available: qty,
          uom: product?.stock_uom || 'pcs',
          last_updated_at: new Date().toISOString(),
        });
      }
    }

    // 3. Update cost_avg on Product (weighted average)
    for (const line of validLines) {
      const unitCost = Number(line.unit_cost);
      if (!unitCost) continue;
      const qty = Number(line.qty);
      const product = products.find(p => p.id === line.product_id);
      if (!product) continue;

      const allStock = stockRecords.filter(s => s.product_id === line.product_id);
      const totalExistingQty = allStock.reduce((s, r) => s + (r.qty_on_hand || 0), 0);
      const existingCost = product.cost_avg || 0;

      // Weighted average: (existing_qty * existing_cost + new_qty * new_cost) / total_qty
      const totalQty = totalExistingQty + qty;
      const newAvg = totalQty > 0 ? ((totalExistingQty * existingCost) + (qty * unitCost)) / totalQty : unitCost;

      await base44.entities.Product.update(product.id, { cost_avg: Math.round(newAvg * 100) / 100 });
    }

    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    queryClient.invalidateQueries({ queryKey: ['active-products'] });
    writeAuditLog({
      action: 'create',
      entity_type: 'StockMovement',
      description: `Received ${validLines.length} products into ${loc?.name}`,
    });
    toast.success(`Received ${validLines.length} products into ${loc?.name} — stock & costs updated`);
    setLines([{ product_id: '', qty: '', unit_cost: '' }]);
    setSaving(false);
  };

  const totalLineValue = validLines.reduce((sum, l) => {
    return sum + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0);
  }, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Receive Stock</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Record incoming stock deliveries</p>
        </div>
        <div className="flex items-center gap-2">
          <HelpDrawer pageKey="receiving" />
          <Button onClick={handleReceive} disabled={saving || validLines.length === 0} className="gap-2" size="lg">
            <PackageCheck className="w-5 h-5" />
            {saving ? 'Receiving...' : `Confirm Receipt (${validLines.length})`}
          </Button>
        </div>
      </div>

      {/* Supplier + Location */}
      <div className="flex items-center gap-4 bg-card border border-border rounded-xl px-6 py-5">
        <div className="flex-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Supplier (optional)</label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger><SelectValue placeholder="Any supplier..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>Any supplier</SelectItem>
              {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Receive Into *</label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger><SelectValue placeholder="Select location..." /></SelectTrigger>
            <SelectContent>
              {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {totalLineValue > 0 && (
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Total Value</p>
            <p className="text-lg font-bold text-foreground">R {totalLineValue.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</p>
          </div>
        )}
      </div>

      {/* Receipt lines */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">Items Received</h3>
          <Button variant="outline" size="sm" onClick={addLine} className="gap-1">
            <Plus className="w-3.5 h-3.5" /> Add Line
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Product</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground w-28">Qty</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground w-32">Unit Cost (R)</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground w-28">Line Total</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((line, idx) => {
                const lineTotal = (Number(line.qty) || 0) * (Number(line.unit_cost) || 0);
                return (
                  <tr key={idx}>
                    <td className="px-4 py-2">
                      <Select value={line.product_id} onValueChange={v => updateLine(idx, 'product_id', v)}>
                        <SelectTrigger><SelectValue placeholder="Select product..." /></SelectTrigger>
                        <SelectContent>
                          <div className="px-2 pb-2">
                            <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-xs" />
                          </div>
                          {supplierProducts.map(p => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.sku} — {p.name} ({p.stock_uom})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-2">
                      <Input type="number" placeholder="0" value={line.qty} onChange={e => updateLine(idx, 'qty', e.target.value)} min="0" />
                    </td>
                    <td className="px-4 py-2">
                      <Input type="number" placeholder="0.00" value={line.unit_cost} onChange={e => updateLine(idx, 'unit_cost', e.target.value)} min="0" step="0.01" />
                    </td>
                    <td className="px-4 py-2 text-muted-foreground font-medium">
                      {lineTotal > 0 ? `R ${lineTotal.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {lines.length > 1 && (
                        <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}