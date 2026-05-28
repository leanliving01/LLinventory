import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44, adjustStockOnHand } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowRight, Plus, Trash2, Save, Search } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import HelpDrawer from '@/components/help/HelpDrawer';
import { writeAuditLog } from '@/lib/auditLog';

export default function StockTransfer() {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState([{ product_id: '', qty: '', notes: '' }]);
  const [fromLocation, setFromLocation] = useState('');
  const [toLocation, setToLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 50),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['active-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const filteredProducts = useMemo(() => {
    if (!search) return products.slice(0, 15);
    const s = search.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s)).slice(0, 15);
  }, [products, search]);

  const addLine = () => setLines(prev => [...prev, { product_id: '', qty: '', notes: '' }]);
  const removeLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx));
  const updateLine = (idx, field, value) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const validLines = lines.filter(l => l.product_id && Number(l.qty) > 0);

  const handleSave = async () => {
    if (!fromLocation || !toLocation) { toast.error('Select both locations'); return; }
    if (fromLocation === toLocation) { toast.error('Locations must be different'); return; }
    if (validLines.length === 0) { toast.error('Add at least one product with quantity'); return; }

    setSaving(true);

    try {
      const fromLoc = locations.find(l => l.id === fromLocation);
      const toLoc = locations.find(l => l.id === toLocation);

      const movements = validLines.map(line => {
        const product = products.find(p => p.id === line.product_id);
        return {
          product_id: line.product_id,
          product_sku: product?.sku || '',
          product_name: product?.name || '',
          from_location_id: fromLocation,
          to_location_id: toLocation,
          qty: Number(line.qty),
          uom: product?.stock_uom || 'pcs',
          reason: 'transfer',
          ref_type: 'transfer',
          ref_number: `${fromLoc?.name} → ${toLoc?.name}`,
          notes: line.notes || `Transfer ${fromLoc?.name} → ${toLoc?.name}`,
        };
      });

      await base44.entities.StockMovement.bulkCreate(movements);

      // Update StockOnHand for both locations atomically
      for (const line of validLines) {
        const qty = Number(line.qty);
        
        // Decrement from location
        await adjustStockOnHand(line.product_id, fromLocation, -qty);
        
        // Increment to location
        await adjustStockOnHand(line.product_id, toLocation, qty);
      }

      queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
      writeAuditLog({
        action: 'create',
        entity_type: 'StockMovement',
        description: `Transfer: ${validLines.length} products from ${fromLoc?.name} to ${toLoc?.name}`,
      });
      toast.success(`Transferred ${validLines.length} products from ${fromLoc?.name} → ${toLoc?.name}`);
      setLines([{ product_id: '', qty: '', notes: '' }]);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stock Transfer</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Move stock between locations</p>
        </div>
        <div className="flex items-center gap-2">
          <HelpDrawer pageKey="stock-transfer" />
          <Button onClick={handleSave} disabled={saving || validLines.length === 0} className="gap-2" size="lg">
            <Save className="w-5 h-5" />
            {saving ? 'Saving...' : `Confirm Transfer (${validLines.length})`}
          </Button>
        </div>
      </div>

      {/* Location selectors */}
      <div className="flex items-center gap-4 bg-card border border-border rounded-xl px-6 py-5">
        <div className="flex-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">From Location</label>
          <Select value={fromLocation} onValueChange={setFromLocation}>
            <SelectTrigger><SelectValue placeholder="Select source..." /></SelectTrigger>
            <SelectContent>
              {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <ArrowRight className="w-6 h-6 text-muted-foreground mt-6 shrink-0" />
        <div className="flex-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">To Location</label>
          <Select value={toLocation} onValueChange={setToLocation}>
            <SelectTrigger><SelectValue placeholder="Select destination..." /></SelectTrigger>
            <SelectContent>
              {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Transfer lines */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">Products to Transfer</h3>
          <Button variant="outline" size="sm" onClick={addLine} className="gap-1">
            <Plus className="w-3.5 h-3.5" /> Add Line
          </Button>
        </div>
        <div className="divide-y divide-border">
          {lines.map((line, idx) => (
            <div key={idx} className="px-6 py-3 flex items-center gap-3">
              <div className="flex-1">
                <Select value={line.product_id} onValueChange={v => updateLine(idx, 'product_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Select product..." /></SelectTrigger>
                  <SelectContent>
                    <div className="px-2 pb-2">
                      <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-xs" />
                    </div>
                    {filteredProducts.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.sku} — {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28">
                <Input
                  type="number"
                  placeholder="Qty"
                  value={line.qty}
                  onChange={e => updateLine(idx, 'qty', e.target.value)}
                  min="0"
                />
              </div>
              <div className="w-48">
                <Input
                  placeholder="Notes (optional)"
                  value={line.notes}
                  onChange={e => updateLine(idx, 'notes', e.target.value)}
                />
              </div>
              {lines.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}