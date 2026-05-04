import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { FileX2, Plus, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import PageHelp from '@/components/help/PageHelp';
import WriteOffList from '@/components/write-offs/WriteOffList';
import CreateWriteOffForm from '@/components/write-offs/CreateWriteOffForm';

const HELP_ITEMS = [
  { title: 'QC-triggered write-offs', text: 'When batches are declined during Morning QC, they automatically appear here as confirmed WIP write-offs with batch details and Rand values.' },
  { title: 'Manual stock write-offs', text: 'Use "New Write-Off" to record any stock that needs to be removed — damaged goods, expired items, stocktake variances, etc. This creates a stock movement and adjusts on-hand quantities.' },
];

export default function StockWriteOffs() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');

  // WIP write-offs (from morning QC)
  const { data: wipWriteOffs = [], isLoading: loadingWip } = useQuery({
    queryKey: ['wip-writeoffs'],
    queryFn: () => base44.entities.WipWriteOff.list('-created_date', 200),
  });

  // Manual stock write-offs
  const { data: stockWriteOffs = [], isLoading: loadingStock } = useQuery({
    queryKey: ['stock-writeoffs'],
    queryFn: () => base44.entities.StockWriteOff.list('-created_date', 200),
  });

  // Combine and sort
  const allWriteOffs = useMemo(() => {
    const wip = wipWriteOffs.map(wo => ({
      ...wo,
      _type: 'wip',
      _displayNumber: wo.write_off_number,
      _displayDate: wo.write_off_date,
      _sortDate: wo.write_off_date || wo.created_date,
    }));
    const manual = stockWriteOffs.map(wo => ({
      ...wo,
      _type: 'manual',
      _displayNumber: wo.write_off_number,
      _displayDate: wo.write_off_date,
      _sortDate: wo.write_off_date || wo.created_date,
    }));
    const combined = [...wip, ...manual];
    combined.sort((a, b) => (b._sortDate || '').localeCompare(a._sortDate || ''));

    if (!search) return combined;
    const s = search.toLowerCase();
    return combined.filter(wo =>
      (wo._displayNumber || '').toLowerCase().includes(s) ||
      (wo.product_name || '').toLowerCase().includes(s) ||
      (wo.product_sku || '').toLowerCase().includes(s) ||
      (wo.notes || '').toLowerCase().includes(s)
    );
  }, [wipWriteOffs, stockWriteOffs, search]);

  const totalValue = allWriteOffs.reduce((s, wo) => s + (wo.total_value || 0), 0);
  const isLoading = loadingWip || loadingStock;

  const handleCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['stock-writeoffs'] });
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    setShowForm(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileX2 className="w-6 h-6 text-red-500" /> Stock Write-Offs
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            QC-triggered and manual stock write-offs
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2">
          <Plus className="w-4 h-4" /> New Write-Off
        </Button>
      </div>

      <PageHelp items={HELP_ITEMS} />

      {showForm && (
        <CreateWriteOffForm
          user={user}
          onCreated={handleCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* KPI strip */}
      <div className="flex items-center gap-6 bg-card border border-border rounded-xl px-6 py-4 flex-wrap">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Total Write-Offs</p>
          <p className="text-lg font-bold">{allWriteOffs.length}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">QC Write-Offs</p>
          <p className="text-lg font-bold">{wipWriteOffs.length}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Manual Write-Offs</p>
          <p className="text-lg font-bold">{stockWriteOffs.length}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Total Value</p>
          <p className="text-lg font-bold text-red-600">R {totalValue.toFixed(2)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search write-offs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading write-offs...</div>
      ) : (
        <WriteOffList writeOffs={allWriteOffs} />
      )}
    </div>
  );
}