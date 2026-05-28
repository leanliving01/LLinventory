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
import HelpDrawer from '@/components/help/HelpDrawer';
import POPagination from '@/components/purchasing/POPagination';
import { writeAuditLog } from '@/lib/auditLog';

export default function Wastage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState({});
  const [saving, setSaving] = useState(false);
  const [productType, setProductType] = useState('finished_meal');
  const [sortBy, setSortBy] = useState('date_desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products-for-wastage', productType],
    queryFn: () => base44.entities.Product.filter({ type: productType, status: 'active' }, '-created_date', 5000),
  });

  const sortedProducts = useMemo(() => {
    let list = products;
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s));
    }
    const sorted = [...list];
    switch (sortBy) {
      case 'date_asc':
        sorted.sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0));
        break;
      case 'name_asc':
        sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
      case 'name_desc':
        sorted.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
        break;
      case 'date_desc':
      default:
        sorted.sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0));
        break;
    }
    return sorted;
  }, [products, search, sortBy]);

  const totalItems = sortedProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const filteredProducts = useMemo(
    () => sortedProducts.slice((page - 1) * pageSize, page * pageSize),
    [sortedProducts, page, pageSize]
  );

  React.useEffect(() => { setPage(1); }, [search, productType, sortBy, pageSize]);

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

    try {
      const today = format(new Date(), 'yyyy-MM-dd');

      // UoM conversion factors to stock UoM
      const convertToStockUom = (qty, entryUom, stockUom) => {
        if (entryUom === stockUom || !entryUom) return qty;
        if (entryUom === 'g' && stockUom === 'kg') return qty / 1000;
        if (entryUom === 'kg' && stockUom === 'g') return qty * 1000;
        if (entryUom === 'ml' && stockUom === 'L') return qty / 1000;
        if (entryUom === 'L' && stockUom === 'ml') return qty * 1000;
        return qty; // fallback — same unit or unknown
      };

      // Build movements with converted quantities stored for SOH update
      const enrichedEntries = validEntries.map(([productId, entry]) => {
        const product = products.find(p => p.id === productId);
        const stockUom = product?.stock_uom || 'pcs';
        const entryUom = entry.uom || stockUom;
        const convertedQty = convertToStockUom(Number(entry.qty), entryUom, stockUom);
        return { productId, entry, product, stockUom, entryUom, convertedQty };
      });

      const movements = enrichedEntries.map(({ productId, entry, product, stockUom, entryUom, convertedQty }) => ({
        product_id: productId,
        product_sku: product?.sku || '',
        product_name: product?.name || '',
        qty: convertedQty,
        uom: stockUom,
        reason: entry.type === 'usable' ? 'wastage_usable' : 'wastage_unusable',
        ref_type: 'wastage_log',
        ref_number: `Wastage ${today}`,
        notes: entry.notes || `End-of-day wastage ${today}` + (entryUom !== stockUom ? ` (entered as ${entry.qty} ${entryUom})` : ''),
      }));

      await base44.entities.StockMovement.bulkCreate(movements);

      // Decrement StockOnHand for all product types
      const stockRecords = await base44.entities.StockOnHand.list('-updated_date', 1000);
      const stockByProduct = {};
      stockRecords.forEach(s => { if (!stockByProduct[s.product_id]) stockByProduct[s.product_id] = s; });

      for (const { productId, convertedQty } of enrichedEntries) {
        const existing = stockByProduct[productId];
        if (existing) {
          const newOnHand = Math.max(0, (existing.qty_on_hand || 0) - convertedQty);
          await base44.entities.StockOnHand.update(existing.id, {
            qty_on_hand: newOnHand,
            qty_available: newOnHand - (existing.qty_committed || 0),
            last_updated_at: new Date().toISOString(),
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
      writeAuditLog({
        action: 'create',
        entity_type: 'StockMovement',
        description: `Recorded ${validEntries.length} end-of-day wastage entries (${productType})`,
        new_value: { entries: validEntries.length, type: productType },
      });
      setEntries({});
      toast.success(`Recorded ${validEntries.length} wastage entries — stock updated`);
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
          <h1 className="text-2xl font-bold text-foreground">End-of-Day Wastage</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {format(new Date(), 'EEEE, dd MMM yyyy')} — record unusable or reusable waste
          </p>
        </div>
        <div className="flex items-center gap-2">
        <HelpDrawer pageKey="wastage" />
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
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="date_desc">Date (newest)</SelectItem>
            <SelectItem value="date_asc">Date (oldest)</SelectItem>
            <SelectItem value="name_asc">Name (A-Z)</SelectItem>
            <SelectItem value="name_desc">Name (Z-A)</SelectItem>
          </SelectContent>
        </Select>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading products...</div>
      ) : (
        <>
          <WastageTable
            products={filteredProducts}
            entries={entries}
            onEntryChange={handleEntryChange}
          />
          <POPagination
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}
    </div>
  );
}