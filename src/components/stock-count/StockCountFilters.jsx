import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, X } from 'lucide-react';

export const EMPTY_STOCK_COUNT_FILTERS = {
  search: '',
  locationId: 'all',
  countType: 'all',
  dateFrom: '',
  dateTo: '',
  assignee: '',
};

export default function StockCountFilters({ filters, onChange }) {
  const update = (key, value) => onChange({ ...filters, [key]: value });

  const [locations, setLocations] = useState([]);

  useEffect(() => {
    let cancelled = false;
    base44.entities.Location
      .filter({ is_stock_bearing: true }, 'name', 200)
      .then(rows => {
        if (!cancelled) setLocations(rows || []);
      })
      .catch(() => {
        if (!cancelled) setLocations([]);
      });
    return () => { cancelled = true; };
  }, []);

  const hasActive =
    filters.search ||
    filters.locationId !== 'all' ||
    filters.countType !== 'all' ||
    filters.dateFrom ||
    filters.dateTo ||
    filters.assignee;

  return (
    <div className="flex items-end gap-3 flex-wrap">
      {/* Search (reference or location) */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search reference or location..."
          value={filters.search}
          onChange={e => update('search', e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Location */}
      <Select value={filters.locationId} onValueChange={v => update('locationId', v)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All locations" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All locations</SelectItem>
          {locations.map(l => (
            <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Count type */}
      <Select value={filters.countType} onValueChange={v => update('countType', v)}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="All types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          <SelectItem value="planned">Planned</SelectItem>
          <SelectItem value="live">Live</SelectItem>
        </SelectContent>
      </Select>

      {/* Date from */}
      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">From</Label>
        <Input
          type="date"
          value={filters.dateFrom}
          onChange={e => update('dateFrom', e.target.value)}
          className="w-[150px]"
        />
      </div>

      {/* Date to */}
      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">To</Label>
        <Input
          type="date"
          value={filters.dateTo}
          onChange={e => update('dateTo', e.target.value)}
          className="w-[150px]"
        />
      </div>

      {/* Assignee / counter */}
      <div className="relative min-w-[160px] max-w-[200px] flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Counter..."
          value={filters.assignee}
          onChange={e => update('assignee', e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Clear */}
      {hasActive && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...EMPTY_STOCK_COUNT_FILTERS })}
          className="gap-1 text-muted-foreground"
        >
          <X className="w-3.5 h-3.5" /> Clear filters
        </Button>
      )}
    </div>
  );
}
