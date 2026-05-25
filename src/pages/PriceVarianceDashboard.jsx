import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, Search, X, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHelp from '@/components/help/PageHelp';

const HELP_ITEMS = [
  { title: 'What is tracked?', text: 'Every time a GRN is confirmed, the system records the price paid vs. the last known price for each product. Changes appear here automatically.' },
  { title: 'Variance %', text: 'Shows the percentage change from the previous price. Red = increase, green = decrease. Items flagged above the supplier threshold are highlighted.' },
  { title: 'Historical trend', text: 'Each row shows the last few prices to help you spot trends. Click a supplier group to expand all changes.' },
];

function VarianceIndicator({ changePct }) {
  if (changePct === 0 || changePct == null) {
    return <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Minus className="w-3 h-3" /> 0%</span>;
  }
  if (changePct > 0) {
    return <span className="text-xs text-red-600 font-medium flex items-center gap-0.5"><TrendingUp className="w-3 h-3" /> +{changePct.toFixed(1)}%</span>;
  }
  return <span className="text-xs text-green-600 font-medium flex items-center gap-0.5"><TrendingDown className="w-3 h-3" /> {changePct.toFixed(1)}%</span>;
}

export default function PriceVarianceDashboard() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['price-history'],
    queryFn: () => base44.entities.SupplierPriceHistory.list('-created_date', 500),
  });

  const filtered = useMemo(() => {
    return history.filter(h => {
      if (search) {
        const q = search.toLowerCase();
        if (!(h.product_name || '').toLowerCase().includes(q) &&
            !(h.product_sku || '').toLowerCase().includes(q) &&
            !(h.supplier_name || '').toLowerCase().includes(q)) return false;
      }
      if (filter === 'flagged') return Math.abs(h.change_pct || 0) > 10;
      if (filter === 'increases') return (h.change_pct || 0) > 0;
      if (filter === 'decreases') return (h.change_pct || 0) < 0;
      return true;
    });
  }, [history, search, filter]);

  const grouped = useMemo(() => {
    const groups = {};
    filtered.forEach(h => {
      const key = h.supplier_name || 'Unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(h);
    });
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const totalChanges = history.length;
  const increases = history.filter(h => (h.change_pct || 0) > 0).length;
  const decreases = history.filter(h => (h.change_pct || 0) < 0).length;
  const flagged = history.filter(h => Math.abs(h.change_pct || 0) > 10).length;

  const FILTER_TABS = [
    { key: 'all', label: 'All Changes' },
    { key: 'flagged', label: `Flagged (>${10}%)` },
    { key: 'increases', label: 'Increases' },
    { key: 'decreases', label: 'Decreases' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-primary" /> Price Variance Tracker
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Supplier price changes captured on each GRN confirmation
          </p>
        </div>
      </div>

      <PageHelp items={HELP_ITEMS} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Total Changes</p>
          <p className="text-lg font-bold">{totalChanges}</p>
        </div>
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-red-600 uppercase font-semibold">Price Increases</p>
          <p className="text-lg font-bold text-red-600">{increases}</p>
        </div>
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-green-600 uppercase font-semibold">Price Decreases</p>
          <p className="text-lg font-bold text-green-600">{decreases}</p>
        </div>
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-amber-600 uppercase font-semibold">Flagged (&gt;10%)</p>
          <p className="text-lg font-bold text-amber-600">{flagged}</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              filter === tab.key
                ? 'bg-primary/10 text-primary ring-2 ring-primary/30'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search product, SKU, or supplier..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading price history...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {history.length === 0 ? 'No price changes recorded yet. Confirm a GRN to start tracking.' : 'No results match your filter.'}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([supplierName, records]) => (
            <div key={supplierName} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold">{supplierName}</h3>
                <span className="text-xs text-muted-foreground">{records.length} change{records.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Previous</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">New Price</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Change</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">UoM</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Source</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {records.slice(0, 15).map(h => {
                      const isFlagged = Math.abs(h.change_pct || 0) > 10;
                      return (
                        <tr key={h.id} className={`hover:bg-muted/20 ${isFlagged ? 'bg-amber-50/50' : ''}`}>
                          <td className="px-3 py-2">
                            <div className="text-sm font-medium">{h.product_name}</div>
                            <div className="text-[11px] font-mono text-muted-foreground">{h.product_sku}</div>
                          </td>
                          <td className="px-3 py-2 text-sm text-right tabular-nums text-muted-foreground">
                            {(h.previous_price || 0) > 0 ? `R ${h.previous_price.toFixed(2)}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-sm text-right tabular-nums font-medium">
                            R {(h.price || 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <VarianceIndicator changePct={h.change_pct} />
                          </td>
                          <td className="px-3 py-2 text-xs">{h.purchase_uom || '—'}</td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className="text-[10px]">{h.source_ref || h.source}</Badge>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{h.effective_date}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {records.length > 15 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground text-center border-t border-border">
                    + {records.length - 15} more — use search to narrow
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}