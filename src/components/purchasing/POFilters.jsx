import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, X, CalendarIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';

export default function POFilters({ filters, onChange, suppliers = [] }) {
  const update = (key, value) => onChange({ ...filters, [key]: value });

  const clearDates = () => onChange({ ...filters, dateFrom: null, dateTo: null });

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search PO# or supplier..."
          value={filters.search}
          onChange={e => update('search', e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Supplier */}
      <Select value={filters.supplierId} onValueChange={v => update('supplierId', v)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All suppliers" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All suppliers</SelectItem>
          {suppliers.map(s => (
            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Date From */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="gap-2 text-sm font-normal min-w-[140px] justify-start">
            <CalendarIcon className="w-4 h-4" />
            {filters.dateFrom ? format(filters.dateFrom, 'dd MMM yyyy') : 'From date'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={filters.dateFrom}
            onSelect={d => update('dateFrom', d)}
            initialFocus
          />
        </PopoverContent>
      </Popover>

      {/* Date To */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="gap-2 text-sm font-normal min-w-[140px] justify-start">
            <CalendarIcon className="w-4 h-4" />
            {filters.dateTo ? format(filters.dateTo, 'dd MMM yyyy') : 'To date'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={filters.dateTo}
            onSelect={d => update('dateTo', d)}
            initialFocus
          />
        </PopoverContent>
      </Popover>

      {/* Sort */}
      <Select value={filters.sortBy} onValueChange={v => update('sortBy', v)}>
        <SelectTrigger className="w-[170px]">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="date_desc">Date (newest)</SelectItem>
          <SelectItem value="date_asc">Date (oldest)</SelectItem>
          <SelectItem value="total_desc">Total (highest)</SelectItem>
          <SelectItem value="total_asc">Total (lowest)</SelectItem>
          <SelectItem value="supplier_asc">Supplier (A-Z)</SelectItem>
          <SelectItem value="supplier_desc">Supplier (Z-A)</SelectItem>
        </SelectContent>
      </Select>

      {/* Clear */}
      {(filters.search || filters.supplierId !== 'all' || filters.dateFrom || filters.dateTo) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({
            search: '',
            supplierId: 'all',
            dateFrom: null,
            dateTo: null,
            sortBy: filters.sortBy,
          })}
          className="gap-1 text-muted-foreground"
        >
          <X className="w-3.5 h-3.5" /> Clear filters
        </Button>
      )}
    </div>
  );
}