import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44, adjustStockOnHand } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, X, Search, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { writeAuditLog } from '@/lib/auditLog';

const REASONS = [
  { value: 'quality_deterioration', label: 'Quality Deterioration' },
  { value: 'shelf_life_exceeded', label: 'Shelf Life Expired' },
  { value: 'contamination', label: 'Contamination' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'stocktake_variance', label: 'Stocktake Variance' },
  { value: 'other', label: 'Other' },
];

export default function CreateWriteOffForm({ user, onCreated, onCancel }) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [writeOffDate, setWriteOffDate] = useState(today);
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [saving, setSaving] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ['products-writeoff-search'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const filteredProducts = useMemo(() => {
    if (!search || search.length < 2) return [];
    const s = search.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s)
    ).slice(0, 15);
  }, [products, search]);

  const handleSelectProduct = (product) => {
    setSelectedProduct(product);
    setSearch('');
  };

  const handleSave = async () => {
    if (!selectedProduct) { toast.error('Select a product'); return; }
    if (!qty || Number(qty) <= 0) { toast.error('Enter a valid quantity'); return; }
    if (!reason) { toast.error('Select a reason'); return; }

    setSaving(true);

    try {
      const product = selectedProduct;
      const qtyNum = Number(qty);
      const unitCost = product.cost_avg || product.cost_current || 0;
      const totalValue = qtyNum * unitCost;

      // Generate write-off number
      const existing = await base44.entities.StockWriteOff.list('-created_date', 1);
      const lastNum = existing.length > 0
        ? parseInt((existing[0].write_off_number || '').replace(/\D/g, '') || '0')
        : 0;
      const woNumber = `SWO-${new Date().getFullYear()}-${String(lastNum + 1).padStart(4, '0')}`;

      // Create write-off record
      const wo = await base44.entities.StockWriteOff.create({
        write_off_number: woNumber,
        write_off_date: writeOffDate,
        effective_date: effectiveDate,
        product_id: product.id,
        product_sku: product.sku,
        product_name: product.name,
        qty: qtyNum,
        uom: product.stock_uom || 'pcs',
        unit_cost: unitCost,
        total_value: totalValue,
        reason,
        notes,
        status: 'confirmed',
        confirmed_by_name: user?.full_name || '',
        confirmed_at: new Date().toISOString(),
      });

      // Create stock movement
      const movement = await base44.entities.StockMovement.create({
        product_id: product.id,
        product_sku: product.sku,
        product_name: product.name,
        qty: qtyNum,
        uom: product.stock_uom || 'pcs',
        reason: 'write_off',
        ref_type: 'manual',
        ref_id: wo.id,
        ref_number: woNumber,
        unit_cost_at_movement: unitCost,
        notes: `Stock write-off: ${REASONS.find(r => r.value === reason)?.label || reason}${notes ? ' — ' + notes : ''}`,
      });

      // Update write-off with movement ID
      await base44.entities.StockWriteOff.update(wo.id, { stock_movement_id: movement.id });

      // Atomically deduct from the most-stocked location for this product
      const stockRecords = await base44.entities.StockOnHand.filter({ product_id: product.id }, '-qty_on_hand', 5);
      if (stockRecords.length > 0) {
        await adjustStockOnHand(product.id, stockRecords[0].location_id, -qtyNum);
      }

      writeAuditLog({
        action: 'create',
        entity_type: 'StockWriteOff',
        entity_id: wo.id,
        description: `Stock write-off ${woNumber}: ${qtyNum} ${product.stock_uom || 'pcs'} of ${product.name} — R ${totalValue.toFixed(2)}`,
      });

      toast.success(`Write-off ${woNumber} confirmed — stock adjusted`);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }

    onCreated?.();
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">New Stock Write-Off</h3>
        <Button variant="ghost" size="icon" className="w-8 h-8" onClick={onCancel}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-muted-foreground font-semibold">Write-Off Date</label>
          <Input type="date" value={writeOffDate} onChange={e => setWriteOffDate(e.target.value)} className="mt-1" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-semibold">Effective Date</label>
          <Input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} className="mt-1" />
        </div>
      </div>

      {/* Product search */}
      <div>
        <label className="text-xs text-muted-foreground font-semibold">Product</label>
        {selectedProduct ? (
          <div className="flex items-center gap-3 mt-1 px-3 py-2 bg-muted/30 border border-border rounded-lg">
            <div className="flex-1">
              <p className="text-sm font-medium">{selectedProduct.name}</p>
              <p className="text-xs text-muted-foreground font-mono">{selectedProduct.sku} · {selectedProduct.stock_uom} · Avg cost: R {(selectedProduct.cost_avg || 0).toFixed(2)}/{selectedProduct.stock_uom}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedProduct(null)} className="text-xs">Change</Button>
          </div>
        ) : (
          <div className="relative mt-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by product code or name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
              autoFocus
            />
            {filteredProducts.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredProducts.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectProduct(p)}
                    className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border last:border-b-0"
                  >
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.sku} · {p.type} · {p.stock_uom}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-muted-foreground font-semibold">Quantity</label>
          <div className="flex items-center gap-2 mt-1">
            <Input
              type="number"
              min="0"
              step="0.1"
              value={qty}
              onChange={e => setQty(e.target.value)}
              placeholder="0"
            />
            {selectedProduct && (
              <span className="text-sm text-muted-foreground whitespace-nowrap">{selectedProduct.stock_uom}</span>
            )}
          </div>
          {selectedProduct && qty && Number(qty) > 0 && (
            <p className="text-xs text-red-600 mt-1 tabular-nums">
              Value: R {(Number(qty) * (selectedProduct.cost_avg || selectedProduct.cost_current || 0)).toFixed(2)}
            </p>
          )}
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-semibold">Reason</label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Select reason..." />
            </SelectTrigger>
            <SelectContent>
              {REASONS.map(r => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground font-semibold">Notes</label>
        <Textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Additional details about the write-off..."
          className="mt-1 h-20"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving || !selectedProduct || !qty || !reason} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Confirm Write-Off
        </Button>
      </div>
    </div>
  );
}