import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Package, Search, X, ShieldCheck, AlertTriangle, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import WipBatchDrawer from '@/components/wip/WipBatchDrawer';
import WipProductCard from '@/components/wip/WipProductCard';
import PageHelp from '@/components/help/PageHelp';

const HELP_ITEMS = [
  { title: 'View bulk cooked stock', text: 'See all WIP batches across your bulk cooked products. The summary strip shows total on-hand kg and carrying value.' },
  { title: 'Quality checks', text: 'Click any batch to open it, then record a quality check. Options: "Approved — Full Quality" (keeps as Fresh), "Approved — Use Today Only", "Quarantine", or "Write Off".' },
  { title: 'Write off stock', text: 'In the batch drawer, use "Write Off Stock" to remove some or all of a batch. Enter the quantity (kg), reason, and notes. The carrying value is automatically deducted.' },
  { title: 'Filter batches', text: 'Use the status tabs (Active, Fresh, Use Today, Quarantine, Written Off) and search bar to filter the batch list.' },
  { title: 'Product summary cards', text: 'The top cards show aggregate stock per bulk product — total kg and number of active batches.' },
];

const QS_STYLES = {
  fresh: 'bg-green-100 text-green-700',
  use_today: 'bg-amber-100 text-amber-700',
  quarantine: 'bg-red-100 text-red-600',
  written_off: 'bg-gray-100 text-gray-500',
};

const QS_LABELS = {
  fresh: 'Fresh',
  use_today: 'Use Today',
  quarantine: 'Quarantine',
  written_off: 'Written Off',
};

export default function WipInventory() {
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [selectedBatch, setSelectedBatch] = useState(null);
  const queryClient = useQueryClient();

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['wip-batches'],
    queryFn: () => base44.entities.WipBatch.list('-created_date', 500),
  });

  const filtered = useMemo(() => {
    return batches.filter(b => {
      // Hide zero-available batches unless viewing written_off or all
      if (statusFilter !== 'written_off' && statusFilter !== 'all' && (b.qty_kg || 0) <= 0) return false;
      if (statusFilter === 'active' && b.quality_status === 'written_off') return false;
      if (statusFilter !== 'active' && statusFilter !== 'all' && b.quality_status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(b.batch_number || '').toLowerCase().includes(q) &&
            !(b.bulk_product_name || '').toLowerCase().includes(q) &&
            !(b.bulk_product_sku || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [batches, statusFilter, search]);

  // Aggregate by product — track original and remaining
  const productSummary = useMemo(() => {
    const map = {};
    batches.filter(b => b.quality_status !== 'written_off' && (b.qty_kg || 0) > 0).forEach(b => {
      const key = b.bulk_product_id;
      if (!map[key]) map[key] = { name: b.bulk_product_name, sku: b.bulk_product_sku, totalKg: 0, originalKg: 0, batchCount: 0, totalValue: 0 };
      map[key].totalKg += b.qty_kg || 0;
      map[key].originalKg += b.original_qty_kg || b.qty_kg || 0;
      map[key].totalValue += b.total_carrying_value || 0;
      map[key].batchCount += 1;
    });
    return Object.values(map).sort((a, b) => b.totalKg - a.totalKg);
  }, [batches]);

  const totalKg = productSummary.reduce((s, p) => s + p.totalKg, 0);
  const totalOriginalKg = productSummary.reduce((s, p) => s + p.originalKg, 0);
  const totalConsumedKg = Math.max(0, totalOriginalKg - totalKg);
  const totalValue = productSummary.reduce((s, p) => s + p.totalValue, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" /> Bulk Cooked Inventory
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            WIP batches, quality checks, and write-offs
          </p>
        </div>
      </div>

      <PageHelp items={HELP_ITEMS} />

      {/* Summary strip */}
      <div className="flex items-center gap-6 bg-card border border-border rounded-xl px-6 py-4 flex-wrap">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Produced</p>
          <p className="text-lg font-bold tabular-nums">{totalOriginalKg.toFixed(2)} kg</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-amber-600 uppercase font-semibold">Portioned</p>
          <p className="text-lg font-bold tabular-nums text-amber-600">{totalConsumedKg.toFixed(2)} kg</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-green-600 uppercase font-semibold">Available</p>
          <p className="text-lg font-bold tabular-nums text-green-600">{totalKg.toFixed(2)} kg</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Carrying Value</p>
          <p className="text-lg font-bold tabular-nums">R {totalValue.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Batches</p>
          <p className="text-lg font-bold tabular-nums">{batches.filter(b => b.quality_status !== 'written_off').length}</p>
        </div>
      </div>

      {/* Product summary cards */}
      {productSummary.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {productSummary.slice(0, 8).map(p => (
            <WipProductCard key={p.sku} {...p} />
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-2">
          {['active', 'fresh', 'use_today', 'written_off', 'all'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                statusFilter === s ? 'bg-primary/10 text-primary ring-2 ring-primary/30' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {s === 'active' ? 'Active' : QS_LABELS[s] || 'All'}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search batches..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      {/* Batch list */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Batch</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Product</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Original</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Portioned</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Available</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Value</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Produced</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.slice(0, 15).map(b => {
                const original = b.original_qty_kg || b.qty_kg || 0;
                const remaining = b.qty_kg || 0;
                const consumed = Math.max(0, Math.round((original - remaining) * 100) / 100);
                return (
                  <tr key={b.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setSelectedBatch(b)}>
                    <td className="px-4 py-2.5 text-sm font-mono font-medium">{b.batch_number}</td>
                    <td className="px-4 py-2.5">
                      <p className="text-sm font-medium">{b.bulk_product_name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">{b.bulk_product_sku}</p>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right tabular-nums text-muted-foreground">{original.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-sm text-right tabular-nums font-medium text-amber-600">{consumed > 0 ? consumed.toFixed(2) : '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                       <span className="text-sm font-bold tabular-nums text-green-600">{remaining.toFixed(2)}</span>
                      <span className="text-[10px] text-muted-foreground ml-0.5">kg</span>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right tabular-nums">R {(b.total_carrying_value || 0).toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge className={`text-[10px] ${QS_STYLES[b.quality_status] || ''}`}>
                        {QS_LABELS[b.quality_status] || b.quality_status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{b.produced_date || '—'}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">No batches found</td></tr>
              )}
            </tbody>
          </table>
          {filtered.length > 15 && (
            <p className="text-center text-xs text-muted-foreground py-3 border-t border-border">
              Showing 15 of {filtered.length} — use search or filters to narrow
            </p>
          )}
        </div>
      )}

      {selectedBatch && (
        <WipBatchDrawer
          batch={selectedBatch}
          onClose={() => setSelectedBatch(null)}
          onUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ['wip-batches'] });
            base44.entities.WipBatch.filter({ id: selectedBatch.id }).then(res => {
              if (res[0]) setSelectedBatch(res[0]);
              else setSelectedBatch(null);
            });
          }}
        />
      )}
    </div>
  );
}