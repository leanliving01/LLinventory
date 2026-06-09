import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  Sun, Thermometer, Snowflake, PackageCheck, Truck, Layers, Warehouse,
  Box, Rows3, Archive
} from 'lucide-react';

/** Icon + color per Location.type */
const ZONE_TYPE_CONFIG = {
  ambient:    { icon: Sun,          bg: 'bg-status-warn-subtle', text: 'text-status-warn',  label: 'Ambient / Dry' },
  chilled:    { icon: Thermometer,  bg: 'bg-status-info-subtle', text: 'text-status-info',  label: 'Chilled' },
  frozen:     { icon: Snowflake,    bg: 'bg-status-info-subtle', text: 'text-status-info',  label: 'Frozen' },
  packing:    { icon: PackageCheck, bg: 'bg-status-good-subtle', text: 'text-status-good',  label: 'Packing' },
  dispatch:   { icon: Truck,        bg: 'bg-status-good-subtle', text: 'text-status-good',  label: 'Dispatch' },
  production: { icon: Warehouse,    bg: 'bg-muted',              text: 'text-muted-foreground', label: 'Production' },
  bin:        { icon: Box,          bg: 'bg-muted',              text: 'text-muted-foreground', label: 'Bin' },
  shelf:      { icon: Rows3,        bg: 'bg-muted',              text: 'text-muted-foreground', label: 'Shelf' },
  storage:    { icon: Archive,      bg: 'bg-muted',              text: 'text-muted-foreground', label: 'Storage Area' },
};

function getZoneConfig(type) {
  return ZONE_TYPE_CONFIG[type] || { icon: Layers, bg: 'bg-muted', text: 'text-muted-foreground', label: type || 'Other' };
}

/**
 * Reusable zone chip selector.
 * Shows an "All" chip + one chip per location.
 * Each chip has an icon matching the zone type.
 */
export default function ZoneSelector({ locations, selectedId, onSelect, className }) {
  const sortedLocations = useMemo(() => {
    return [...locations].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [locations]);

  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)}>
      {/* All zones chip */}
      <ZoneChip
        icon={Layers}
        label="All Zones"
        active={!selectedId}
        onClick={() => onSelect(null)}
        bg="bg-muted"
        text="text-muted-foreground"
      />
      {sortedLocations.map(loc => {
        const config = getZoneConfig(loc.type);
        const Icon = config.icon;
        // Use short name: strip "Main Warehouse: " prefix if present
        const shortName = (loc.name || '').replace(/^Main Warehouse:\s*/i, '');
        return (
          <ZoneChip
            key={loc.id}
            icon={Icon}
            label={shortName || loc.code}
            active={selectedId === loc.id}
            onClick={() => onSelect(loc.id)}
            bg={config.bg}
            text={config.text}
          />
        );
      })}
    </div>
  );
}

function ZoneChip({ icon: Icon, label, active, onClick, bg, text }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border",
        active
          ? "border-primary bg-primary/10 text-primary shadow-xs"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
      )}
    >
      <span className={cn("w-6 h-6 rounded-md flex items-center justify-center shrink-0", active ? 'bg-primary/15' : bg)}>
        <Icon className={cn("w-3.5 h-3.5", active ? 'text-primary' : text)} strokeWidth={1.5} />
      </span>
      <span className="truncate max-w-[120px]">{label}</span>
    </button>
  );
}

export { getZoneConfig, ZONE_TYPE_CONFIG };