import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileX2, Plus, Search } from 'lucide-react';
import { subDays, startOfMonth, isWithinInterval, startOfDay } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import PageHelp from '@/components/help/PageHelp';
import WriteOffList from '@/components/write-offs/WriteOffList';
import CreateWriteOffForm from '@/components/write-offs/CreateWriteOffForm';
import WriteOffTrendChart from '@/components/dashboard/WriteOffTrendChart';

const REASON_LABELS = {
  quality_deterioration: 'Quality Deterioration',
  shelf_life_exceeded: 'Shelf Life Exceeded',
  contamination: 'Contamination',
  damaged: 'Damaged',
  stocktake_variance: 'Stocktake Variance',
  other: 'Other',
};

const PRESETS = [
  { key: 'all', label: 'All Time' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom' },
];

const HELP_ITEMS = [
  { title: 'QC-triggered write-offs', text: 'When batches are declined during Morning QC, they automatically appear here as confirmed WIP write-offs with batch details and Rand values.' },
  { title: 'Manual stock write-offs', text: 'Use "New Write-Off" to record any stock that needs to be removed — damaged goods, expired items, stocktake variances, etc. This creates a stock movement and adjusts on-hand quantities.' },
];

export default function StockWriteOffs() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [reasonFilter, setReasonFilter] = useState('all');
  const [preset, setPreset] = useState('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const now = new Date();

  const { dateFrom, dateTo } = useMemo(() => {
    if (preset === 'all') return { dateFrom: null, dateTo: null };
    if (preset === 'today') return { dateFrom: startOfDay(now), dateTo: now };
    if (preset === '7d') return { dateFrom: startOfDay(subDays(now, 7)), dateTo: now };
    if (preset === '30d') return { dateFrom: startOfDay(subDays(now, 30)), dateTo: now };
    if (preset === 'month') return { dateFrom: startOfMonth(now), dateTo: now };
    if (preset === 'custom' && customFrom && customTo) {
      return { dateFrom: startOfDay(new Date(customFrom)), dateTo: new Date(customTo) };
    }
    return { dateFrom: startOfDay(subDays(now, 30)), dateTo: now };
  }, [preset, customFrom, customTo]);

  const inRange = (dateStr) => {
    if (!dateStr) return !dateFrom; // no date = only show if "all time"
    if (!dateFrom) return true;
    const d = new Date(dateStr);
    return isWithinInterval(d, { start: dateFrom, end: dateTo });
  };

  const { data: wipWriteOffs = [], isLoading: loadingWip } = useQuery({
    queryKey: ['wip-writeoffs'],
    queryFn: () => base44.entities.WipWriteOff.list('-created_date', 500),
  });

  const { data: stockWriteOffs = [], isLoading: loadingStock } = useQuery({
    queryKey: ['stock-writeoffs'],
    queryFn: () => base44.entities.StockWriteOff.list('-created_date', 500),
  });

  const allWriteOffs = useMemo(() => {
    const wip = wipWriteOffs
      .filter(wo => inRange(wo.write_off_date))
      .map(wo => ({
        ...wo,
        _type: 'wip',
        _displayNumber: wo.write_off_number,
        _displayDate: wo.write_off_date,
        _sortDate: wo.write_off_date || wo.created_date,
      }));

    const manual = stockWriteOffs
      .filter(wo => inRange(wo.write_off_date))
      .filter(wo => reasonFilter === 'all' || wo.reason === reasonFilter)
      .map(wo => ({
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
  }, [wipWriteOffs, stockWriteOffs, search, reasonFilter, dateFrom, dateTo]);

  const totalValue = allWriteOffs.reduce((s, wo) => s + (wo.total_value || 0), 0);
  const wipCount = allWriteOffs.filter(wo => wo._type === 'wip').length;
  const manualCount = allWriteOffs.filter(wo => wo._type === 'manual').length;
  const avgValuePerEvent = allWriteOffs.length > 0 ? totalValue / allWriteOffs.length : 0;

  const isLoading = loadingWip || loadingStock;

  const handleCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['stock-writeoffs'] });
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    setShowForm(false);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileX2 className="w-6 h-6 text-red-500" /> Stock Write-Offs
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            QC-triggered and manual stock write-offs — kitchen waste KPI
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

      {/* Date range presets */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium">Period:</span>
        {PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              preset === p.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:bg-muted/60'
            }`}
          >
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="h-8 text-xs border border-border rounded-md px-2 bg-background text-foreground"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="h-8 text-xs border border-border rounded-md px-2 bg-background text-foreground"
            />
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl px-5 py-4">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Total Events</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">{allWriteOffs.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">in selected period</p>
        </div>
        <div className="bg-card border border-border rounded-xl px-5 py-4">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">QC Write-Offs</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">{wipCount}</p>
          <p className="text-xs text-muted-foreground mt-0.5">from morning QC</p>
        </div>
        <div className="bg-card border border-border rounded-xl px-5 py-4">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Manual Write-Offs</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">{manualCount}</p>
          <p className="text-xs text-muted-foreground mt-0.5">user recorded</p>
        </div>
        <div className="bg-card border border-red-200 dark:border-red-900/40 rounded-xl px-5 py-4 bg-red-50/60 dark:bg-red-950/10">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Total Value Lost</p>
          <p className="text-2xl font-bold mt-1 tabular-nums text-red-600">R {totalValue.toFixed(0)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {allWriteOffs.length > 0 ? `avg R ${avgValuePerEvent.toFixed(0)} / event` : 'no write-offs'}
          </p>
        </div>
      </div>

      {/* Trend chart — only when a period is selected (not "All Time") */}
      {dateFrom && (
        <WriteOffTrendChart writeOffs={allWriteOffs} from={dateFrom} to={dateTo} />
      )}

      {/* Filters row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by number, product, or notes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={reasonFilter} onValueChange={setReasonFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All Reasons" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Reasons</SelectItem>
            {Object.entries(REASON_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(search || reasonFilter !== 'all') && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setReasonFilter('all'); }}>
            Clear filters
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading write-offs...</div>
      ) : allWriteOffs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileX2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No write-offs in this period</p>
          <p className="text-xs mt-1">Try changing the date range or clearing filters</p>
        </div>
      ) : (
        <WriteOffList writeOffs={allWriteOffs} />
      )}
    </div>
  );
}
