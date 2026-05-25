import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getZoneConfig } from '@/components/stock-take/ZoneSelector';

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
        {filtered.map(loc => {
          const config = getZoneConfig(loc.type);
          const Icon = config.icon;
          return (
            <button
              key={loc.id}
              onClick={() => onSelect(loc)}
              className={cn(
                "bg-card border-2 rounded-2xl p-4 flex items-center gap-3 active:scale-[0.97] transition-transform text-left",
                selectedId === loc.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              )}
            >
              <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0", config.bg)}>
                <Icon className={cn("w-5 h-5", config.text)} strokeWidth={1.5} />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{loc.name}</p>
                <p className="text-xs text-muted-foreground">{loc.code} · {config.label}</p>
              </div>
            </button>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No stock-bearing zones found.</p>
      )}
    </div>
  );
}