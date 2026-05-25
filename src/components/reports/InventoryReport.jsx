import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Download, Printer, Search } from 'lucide-react';
import { downloadCSV } from '@/lib/csvExport';

export default function InventoryReport() {
  const [search, setSearch] = useState('');

  const { data: products = [] } = useQuery({
    queryKey: ['report-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const { data: stock = [] } = useQuery({
    queryKey: ['report-soh'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 2000),
  });

  const rows = useMemo(() => {
    const stockByProduct = {};
    stock.forEach(s => {
      if (!stockByProduct[s.product_id]) stockByProduct[s.product_id] = { on_hand: 0, committed: 0, locations: [] };
      stockByProduct[s.product_id].on_hand += s.qty_on_hand || 0;
      stockByProduct[s.product_id].committed += s.qty_committed || 0;
      if (s.location_name) stockByProduct[s.product_id].locations.push(s.location_name);
    });

    return products.map(p => {
      const s = stockByProduct[p.id] || { on_hand: 0, committed: 0, locations: [] };
      const available = s.on_hand - s.committed;
      const reorder = p.min_before_reorder || 0;
      const status = reorder > 0 && available <= 0 ? 'out' : reorder > 0 && available < reorder ? 'low' : 'ok';
      return {
        sku: p.sku, name: p.name, type: p.type, uom: p.stock_uom,
        on_hand: Math.round(s.on_hand * 100) / 100,
        committed: Math.round(s.committed * 100) / 100,
        available: Math.round(available * 100) / 100,
        reorder_point: reorder,
        value: Math.round(s.on_hand * (p.cost_avg || 0) * 100) / 100,
        status,
        locations: [...new Set(s.locations)].join(', '),
      };
    }).filter(r => {
      if (!search) return true;
      const q = search.toLowerCase();
      return r.sku.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
    }).sort((a, b) => {
      const order = { out: 0, low: 1, ok: 2 };
      return (order[a.status] ?? 2) - (order[b.status] ?? 2) || a.name.localeCompare(b.name);
    });
  }, [products, stock, search]);

  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const lowCount = rows.filter(r => r.status === 'low' || r.status === 'out').length;

  const handleExport = () => downloadCSV('inventory_report.csv', rows);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..." className="pl-8 h-8 text-xs" />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5 text-xs h-8"><Download className="w-3.5 h-3.5" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5 text-xs h-8"><Printer className="w-3.5 h-3.5" /> Print</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <SumCard label="Active Products" value={rows.length} />
        <SumCard label="Low / Out of Stock" value={lowCount} warn={lowCount > 0} />
        <SumCard label="Total Inventory Value" value={`R ${totalValue.toLocaleString()}`} accent />
      </div>

      <div className="border border-border rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {['SKU', 'Product', 'Type', 'On Hand', 'Committed', 'Available', 'Reorder Pt', 'Value (ZAR)', 'Status'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">No products found</td></tr>
            ) : rows.slice(0, 100).map(r => (
              <tr key={r.sku} className="hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">{r.sku}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-muted-foreground text-xs">{r.type}</td>
                <td className="px-3 py-2 text-right">{r.on_hand} {r.uom}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{r.committed}</td>
                <td className="px-3 py-2 text-right font-medium">{r.available}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{r.reorder_point || '—'}</td>
                <td className="px-3 py-2 text-right">R {r.value.toLocaleString()}</td>
                <td className="px-3 py-2 text-center">
                  <Badge className={`text-[10px] ${
                    r.status === 'out' ? 'bg-red-100 text-red-700' :
                    r.status === 'low' ? 'bg-amber-100 text-amber-700' :
                    'bg-green-100 text-green-700'
                  }`}>{r.status === 'out' ? 'Out' : r.status === 'low' ? 'Low' : 'OK'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 100 && <p className="text-xs text-muted-foreground text-center py-2">Showing 100 of {rows.length} — export CSV for full data</p>}
      </div>
    </div>
  );
}

function SumCard({ label, value, accent, warn }) {
  return (
    <div className={`rounded-lg px-4 py-3 border ${
      accent ? 'bg-primary/10 border-primary/20' : warn ? 'bg-amber-50 border-amber-200' : 'bg-muted/50 border-border'
    }`}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${accent ? 'text-primary' : warn ? 'text-amber-700' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}