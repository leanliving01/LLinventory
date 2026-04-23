import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Save, Search, X } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import WastageTable from '@/components/wastage/WastageTable';

export default function Wastage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState({});
  const [saving, setSaving] = useState(false);
  const [productType, setProductType] = useState('finished_meal');

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products-for-wastage', productType],
    queryFn: () => base44.entities.Product.filter({ type: productType, status: 'active' }, 'name', 500),
  });

  const filteredProducts = useMemo(() => {
    if (!search) return products.slice(0, 30); // limit to 30 for performance
    const s = search.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s)).slice(0, 30);
  }, [products, search]);

  const handleEntryChange = (productId, field, value) => {
    setEntries(prev => ({
      ...prev,
      [productId]: { ...prev[productId], [field]: value },
    }));
  };

  const entryCount = Object.values(entries).filter(e => e?.qty && Number(e.qty) > 0).length;

  const handleSave = async () => {
    const validEntries = Object.entries(entries).filter(([_, e]) => e?.qty && Number(e.qty) > 0);
    if (validEntries.length === 0) {
      toast.error('No wastage to record');
      return;
    }

    setSaving(true);
    const today = format(new Date(), 'yyyy-MM-dd');

    // Create StockMovement records for each wastage entry
    const movements = validEntries.map(([productId, entry]) => {
      const product = products.find(p => p.id === productId);
      const reason = entry.type === 'usable' ? 'wastage_usable' : 'wastage_unusable';
      return {
        product_id: productId,
        product_sku: product?.sku || '',
        product_name: product?.name || '',
        qty: Number(entry.qty),
        uom: product?.stock_uom || 'pcs',
        reason,
        notes: entry.notes || `End-of-day wastage ${today}`,
      };
    });

    await base44.entities.StockMovement.bulkCreate(movements);

    // Decrement StockOnHand for finished meals
    if (productType === 'finished_meal') {
      const stockRecords = await base44.entities.StockOnHand.list('-updated_date', 1000);
      const stockByProduct = {};
      stockRecords.forEach(s => { if (!stockByProduct[s.product_id]) stockByProduct[s.product_id] = s; });

      for (const [productId, entry] of validEntries) {
        const existing = stockByProduct[productId];
        if (existing) {
          const newOnHand = Math.max(0, (existing.qty_on_hand || 0) - Number(entry.qty));
          await base44.entities.StockOnHand.update(existing.id, {
            qty_on_hand: newOnHand,
            qty_available: newOnHand - (existing.qty_committed || 0),
            last_updated_at: new Date().toISOString(),
          });
        }
      }
    }

    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    setEntries({});
    toast.success(`Recorded ${validEntries.length} wastage entries — stock updated`);
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">End-of-Day Wastage</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {format(new Date(), 'EEEE, dd MMM yyyy')} — record unusable or reusable waste
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving || entryCount === 0}
          className="gap-2"
          size="lg"
        >
          <Save className="w-5 h-5" />
          {saving ? 'Saving...' : `Record Wastage (${entryCount})`}
        </Button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <strong>End-of-day only.</strong> Rice, veg, and sauce are reused across runs — only record what's actually wasted at day end.
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={productType} onValueChange={setProductType}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="finished_meal">Finished Meals</SelectItem>
            <SelectItem value="raw">Raw Materials</SelectItem>
            <SelectItem value="wip_bulk">Bulk Cooked (WIP)</SelectItem>
            <SelectItem value="sauce">Sauces</SelectItem>
            <SelectItem value="packaging">Packaging</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading products...</div>
      ) : (
        <WastageTable
          products={filteredProducts}
          entries={entries}
          onEntryChange={handleEntryChange}
        />
      )}
    </div>
  );
}