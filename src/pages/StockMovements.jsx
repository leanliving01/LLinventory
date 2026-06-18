import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowRightLeft, Search, ChevronLeft, ChevronRight, CalendarIcon, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import MovementGroupRow from '@/components/movements/MovementGroupRow';

const PAGE_SIZE = 25;

const REASON_OPTIONS = [
  { value: 'all',                   label: 'All Types' },
  { value: 'sale_fulfillment',      label: 'Order Fulfilled' },
  { value: 'receipt',               label: 'Receipt' },
  { value: 'transfer',              label: 'Transfer' },
  { value: 'production_pick',       label: 'Pick → Production' },
  { value: 'production_return',     label: 'Return from Production' },
  { value: 'production_consume',    label: 'Production Use (Legacy)' },
  { value: 'production_yield',      label: 'Production Output' },
  { value: 'wastage_usable',        label: 'Wastage (Usable)' },
  { value: 'wastage_unusable',      label: 'Wastage (Unusable)' },
  { value: 'stocktake_adjustment',  label: 'Stock Count Adj.' },
  { value: 'packing_material',      label: 'Packing Material' },
  { value: 'return',                label: 'Return' },
  { value: 'supplier_return',       label: 'Supplier Return' },
  { value: 'cancellation_reversal', label: 'Cancellation Reversal' },
  { value: 'write_off',             label: 'Write Off' },
];

export default function StockMovements() {
  const [search, setSearch]               = useState('');
  const [debouncedSearch, setDebounced]   = useState('');
  const [reasonFilter, setReasonFilter]   = useState('all');
  const [dateFrom, setDateFrom]           = useState(null);
  const [dateTo, setDateTo]               = useState(null);
  const [page, setPage]                   = useState(0);

  // Debounce search input — only fire RPC after 400ms of inactivity
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim() || null), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 0 whenever any filter changes
  useEffect(() => { setPage(0); }, [reasonFilter, dateFrom, dateTo, debouncedSearch]);

  const { data, isLoading } = useQuery({
    queryKey: ['movement-groups', reasonFilter, dateFrom, dateTo, debouncedSearch, page],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_movement_groups', {
        p_limit:     PAGE_SIZE,
        p_offset:    page * PAGE_SIZE,
        p_reason:    reasonFilter === 'all' ? null : reasonFilter,
        p_search:    debouncedSearch || null,
        p_from_date: dateFrom
          ? new Date(new Date(dateFrom).setHours(0, 0, 0, 0)).toISOString()
          : null,
        p_to_date: dateTo
          ? new Date(new Date(dateTo).setHours(23, 59, 59, 999)).toISOString()
          : null,
      });
      if (error) {
        console.error('[stock-movements]', error.message);
        return { total: 0, groups: [] };
      }
      return data || { total: 0, groups: [] };
    },
  });

  const groups     = data?.groups || [];
  const total      = data?.total  || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stock Movements</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Full audit trail of all inventory changes</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search order #, SKU, product…"
            className="pl-9"
          />
        </div>

        <Select value={reasonFilter} onValueChange={v => setReasonFilter(v)}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REASON_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2 text-sm font-normal min-w-[140px] justify-start">
              <CalendarIcon className="w-4 h-4" />
              {dateFrom ? format(dateFrom, 'dd MMM yyyy') : 'From date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2 text-sm font-normal min-w-[140px] justify-start">
              <CalendarIcon className="w-4 h-4" />
              {dateTo ? format(dateTo, 'dd MMM yyyy') : 'To date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus />
          </PopoverContent>
        </Popover>

        {(dateFrom || dateTo) && (
          <Button
            variant="ghost" size="sm"
            onClick={() => { setDateFrom(null); setDateTo(null); }}
            className="gap-1 text-muted-foreground"
          >
            <X className="w-3.5 h-3.5" /> Clear dates
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Table header bar */}
        <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-muted-foreground" />
            Movements
            {total > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                — {total.toLocaleString()} event{total !== 1 ? 's' : ''}
              </span>
            )}
          </h3>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-2">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : groups.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            No movements found
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground bg-muted/20">
                <th className="w-8 px-2 py-2.5"></th>
                <th className="text-left px-3 py-2.5 font-medium">Date</th>
                <th className="text-left px-3 py-2.5 font-medium">Reference</th>
                <th className="text-left px-3 py-2.5 font-medium">Type</th>
                <th className="text-right px-3 py-2.5 font-medium">Qty</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <MovementGroupRow
                  key={`${g.ref_type || ''}-${g.ref_id || ''}-${g.ref_number || ''}-${g.reason}-${i}`}
                  group={g}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
