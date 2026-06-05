import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, Warehouse, ArrowLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getZoneConfig } from '@/components/stock-take/ZoneSelector';
import { splitLocations } from '@/lib/locationHierarchy';

/**
 * Two-step location picker for the floor app: pick a warehouse, then a zone
 * within it. Warehouses with no zones (or non-stock-bearing) select directly.
 *
 * Keeps the original `onSelect(location)` contract — callers always receive a
 * single resolved location (the chosen zone, or the warehouse itself).
 */
export default function FloorZonePicker({ title, subtitle, onSelect, selectedId, excludeId }) {
  const [warehouse, setWarehouse] = useState(null); // drill-down state

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ['locations-all'],
    queryFn: () => base44.entities.Location.list('name', 200),
    staleTime: 5 * 60 * 1000,
  });

  const { warehouses, zonesByWarehouse } = useMemo(() => splitLocations(locations), [locations]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading locations...
      </div>
    );
  }

  const filterExcluded = (list) => (excludeId ? list.filter(l => l.id !== excludeId) : list);

  // ── Step 2: zones within the chosen warehouse ──
  if (warehouse) {
    const zones = filterExcluded((zonesByWarehouse[warehouse.id] || []).filter(z => z.is_stock_bearing));
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setWarehouse(null)} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold">{warehouse.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Pick a zone</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* Whole warehouse (counts everything not pinned to a zone) */}
          {warehouse.is_stock_bearing && warehouse.id !== excludeId && (
            <LocationButton
              loc={warehouse}
              icon={Warehouse}
              label="Whole warehouse"
              selected={selectedId === warehouse.id}
              onClick={() => onSelect(warehouse)}
            />
          )}
          {zones.map(z => {
            const config = getZoneConfig(z.type);
            return (
              <LocationButton
                key={z.id}
                loc={z}
                icon={config.icon}
                iconBg={config.bg}
                iconColor={config.text}
                label={z.name}
                sub={`${z.code} · ${config.label}`}
                selected={selectedId === z.id}
                onClick={() => onSelect(z)}
              />
            );
          })}
        </div>
        {zones.length === 0 && !warehouse.is_stock_bearing && (
          <p className="text-sm text-muted-foreground text-center py-8">No stock-bearing zones in this warehouse.</p>
        )}
      </div>
    );
  }

  // ── Step 1: warehouses ──
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {warehouses.map(wh => {
          const zones = (zonesByWarehouse[wh.id] || []).filter(z => z.is_stock_bearing);
          const hasZones = zones.length > 0;
          // Skip warehouses with nowhere to put stock.
          if (!hasZones && !wh.is_stock_bearing) return null;
          // A zone-less warehouse selects directly — hide it if it's the excluded one.
          if (!hasZones && wh.id === excludeId) return null;
          return (
            <button
              key={wh.id}
              onClick={() => (hasZones ? setWarehouse(wh) : onSelect(wh))}
              className={cn(
                "bg-card border-2 rounded-2xl p-4 flex items-center gap-3 active:scale-[0.97] transition-transform text-left",
                "border-border hover:border-primary/40"
              )}
            >
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Warehouse className="w-5 h-5 text-primary" strokeWidth={1.5} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate">{wh.name}</p>
                <p className="text-xs text-muted-foreground">
                  {wh.code}{hasZones ? ` · ${zones.length} zone${zones.length !== 1 ? 's' : ''}` : ''}
                </p>
              </div>
              {hasZones && <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />}
            </button>
          );
        })}
      </div>
      {warehouses.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No warehouses found.</p>
      )}
    </div>
  );
}

function LocationButton({ icon: Icon, label, sub, selected, onClick, iconBg = 'bg-primary/10', iconColor = 'text-primary' }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "bg-card border-2 rounded-2xl p-4 flex items-center gap-3 active:scale-[0.97] transition-transform text-left",
        selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
      )}
    >
      <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0", iconBg)}>
        <Icon className={cn("w-5 h-5", iconColor)} strokeWidth={1.5} />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-sm truncate">{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </button>
  );
}
