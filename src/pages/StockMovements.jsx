import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ArrowRightLeft, Search, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { formatDateTimeSAST, formatDateSAST } from '@/lib/dateUtils';
import MovementRow from '@/components/movements/MovementRow';
import { exportMovementsCSV } from '@/lib/csvExport';

const PAGE_SIZE = 15;

const REASON_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'production_consume', label: 'Production Use' },
  { value: 'production_yield', label: 'Production Output' },
  { value: 'sale_fulfillment', label: 'Order Fulfilled' },
  { value: 'wastage_usable', label: 'Wastage (Usable)' },
  { value: 'wastage_unusable', label: 'Wastage (Unusable)' },
  { value: 'stocktake_adjustment', label: 'Stock Count Adj.' },
  { value: 'packing_material', label: 'Packing Material' },
  { value: 'return', label: 'Return' },
  { value: 'write_off', label: 'Write Off' },
];

export default function StockMovements() {
  const [search, setSearch] = useState('');
  const [reasonFilter, setReasonFilter] = useState('all');
  const [page, setPage] = useState(0);

  // Fetch movements — most recent first
  const filter = reasonFilter !== 'all' ? { reason: reasonFilter } : {};
  const { data: movements = [], isLoading } = useQuery({
    queryKey: ['all-movements', reasonFilter, page],
    queryFn: () => base44.entities.StockMovement.filter(
      filter,
      '-created_date',
      PAGE_SIZE,
      page * PAGE_SIZE
    ),
  });

  // Client-side search filter (on the current page)
  const filtered = useMemo(() => {
    if (!search) return movements;
    const s = search.toLowerCase();
    return movements.filter(m =>
      (m.product_sku || '').toLowerCase().includes(s) ||
      (m.product_name || '').toLowerCase().includes(s) ||
      (m.ref_number || '').toLowerCase().includes(s) ||
      (m.notes || '').toLowerCase().includes(s)
    );
  }, [movements, search]);

  const handleExport = () => {
    if (movements.length === 0) return;
    const rows = filtered.map(m => ({
      Date: formatDateTimeSAST(m.created_date),
      SKU: m.product_sku || '',
      Product: m.product_name || '',
      Reason: m.reason || '',
      Qty: m.qty,
      UoM: m.uom || '',
      Reference: m.ref_number || '',
      Notes: m.notes || '',
    }));
    exportMovementsCSV(rows, `stock-movements-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stock Movements</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Full audit trail of all inventory changes</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5" disabled={filtered.length === 0}>
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search SKU, product, reference..."
            className="pl-9"
          />
        </div>
        <Select value={reasonFilter} onValueChange={v => { setReasonFilter(v); setPage(0); }}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REASON_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-muted-foreground" /> Movements
          </h3>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-2">Page {page + 1}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={movements.length < PAGE_SIZE} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            No movements found
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground bg-muted/20">
                <th className="w-8 px-2 py-2.5"></th>
                <th className="text-left px-3 py-2.5 font-medium">Date</th>
                <th className="text-left px-3 py-2.5 font-medium">Product</th>
                <th className="text-left px-3 py-2.5 font-medium">Reason</th>
                <th className="text-right px-3 py-2.5 font-medium">Qty</th>
                <th className="text-left px-3 py-2.5 font-medium">Reference</th>
                <th className="text-left px-3 py-2.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(m => (
                <MovementRow key={m.id} movement={m} showProduct />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}