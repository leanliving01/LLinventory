import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

const ZONE_COLORS = {
  ambient: 'bg-yellow-100 text-yellow-700',
  chilled: 'bg-blue-100 text-blue-700',
  frozen: 'bg-indigo-100 text-indigo-700',
  production: 'bg-amber-100 text-amber-700',
  packing: 'bg-pink-100 text-pink-700',
  dispatch: 'bg-green-100 text-green-700',
};

export default function FloorZonePicker({ title, subtitle, onSelect, selectedId, excludeId }) {
  const { data: locations = [], isLoading } = useQuery({
    queryKey: ['locations-stock-bearing'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 50),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading zones...
      </div>
    );
  }

  const filtered = excludeId ? locations.filter(l => l.id !== excludeId) : locations;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {filtered.map(loc => (
          <button
            key={loc.id}
            onClick={() => onSelect(loc)}
            className={cn(
              "bg-card border-2 rounded-2xl p-4 flex items-center gap-3 active:scale-[0.97] transition-transform text-left",
              selectedId === loc.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
            )}
          >
            <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0", ZONE_COLORS[loc.type] || 'bg-muted text-muted-foreground')}>
              <MapPin className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{loc.name}</p>
              <p className="text-xs text-muted-foreground">{loc.code} · {loc.type}</p>
            </div>
          </button>
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No stock-bearing zones found.</p>
      )}
    </div>
  );
}