import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Warehouse, Pencil, Check, X, ChevronDown, ChevronRight, MapPin, Loader2 } from 'lucide-react';
import { cn, formatLocationAddress } from '@/lib/utils';
import WarehouseZoneRow from './WarehouseZoneRow';
import AddZoneForm from './AddZoneForm';
import LocationAddressFields from './LocationAddressFields';

const ADDRESS_KEYS = ['address_line1', 'address_line2', 'suburb', 'city', 'province', 'postal_code'];
const pickAddress = (loc) => Object.fromEntries(ADDRESS_KEYS.map(k => [k, loc?.[k] || '']));

export default function WarehouseCard({ warehouse, zones, onRenameWarehouse, onSaveWarehouseAddress, onSaveZone, onDeleteZone, onAddZone }) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState(warehouse.name);
  const [editingAddress, setEditingAddress] = useState(false);
  const [address, setAddress] = useState(() => pickAddress(warehouse));
  const [savingAddress, setSavingAddress] = useState(false);

  const formattedAddress = formatLocationAddress(warehouse);

  const handleRename = () => {
    if (newName.trim() && newName.trim() !== warehouse.name) {
      onRenameWarehouse(warehouse.id, newName.trim());
    }
    setEditing(false);
  };

  const handleSaveAddress = async () => {
    setSavingAddress(true);
    try {
      await onSaveWarehouseAddress?.(warehouse.id, address);
      setEditingAddress(false);
    } finally {
      setSavingAddress(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden shadow-xs">
      {/* Warehouse header */}
      <div className="px-5 py-3.5 flex items-center gap-3 border-b border-border">
        <button onClick={() => setExpanded(!expanded)} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
          {expanded
            ? <ChevronDown className="w-4 h-4" strokeWidth={1.5} />
            : <ChevronRight className="w-4 h-4" strokeWidth={1.5} />}
        </button>
        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Warehouse className="w-4 h-4 text-primary" strokeWidth={1.5} />
        </div>
        {editing ? (
          <div className="flex items-center gap-2 flex-1">
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="h-8 text-sm font-semibold flex-1"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleRename()}
            />
            <Button size="icon" variant="ghost" className="h-7 w-7 text-status-good" onClick={handleRename}><Check className="w-4 h-4" strokeWidth={1.5} /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setNewName(warehouse.name); setEditing(false); }}><X className="w-4 h-4" strokeWidth={1.5} /></Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h3 className="text-sm font-semibold truncate">{warehouse.name}</h3>
            <span className="text-[11px] text-muted-foreground font-mono">{warehouse.code}</span>
            <span className="text-[11px] text-muted-foreground">· {zones.length} zone{zones.length !== 1 ? 's' : ''}</span>
            <Button size="icon" variant="ghost" className="h-7 w-7 ml-auto opacity-60 hover:opacity-100" onClick={() => setEditing(true)}>
              <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
            </Button>
          </div>
        )}
      </div>

      {/* Address */}
      {expanded && (
        <div className="px-5 py-3 border-b border-border bg-muted/20">
          {editingAddress ? (
            <div className="space-y-3">
              <LocationAddressFields value={address} onChange={(k, v) => setAddress(prev => ({ ...prev, [k]: v }))} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setAddress(pickAddress(warehouse)); setEditingAddress(false); }}>Cancel</Button>
                <Button size="sm" className="gap-1.5" onClick={handleSaveAddress} disabled={savingAddress}>
                  {savingAddress ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save Address
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" strokeWidth={1.5} />
              <p className="text-xs text-muted-foreground flex-1">
                {formattedAddress || <span className="italic">No physical address set</span>}
              </p>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1" onClick={() => { setAddress(pickAddress(warehouse)); setEditingAddress(true); }}>
                <Pencil className="w-3 h-3" strokeWidth={1.5} /> {formattedAddress ? 'Edit' : 'Add'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Zones */}
      {expanded && (
        <div className="divide-y divide-border">
          {zones.length === 0 && (
            <p className="px-5 py-4 text-sm text-muted-foreground">No zones yet — add one below.</p>
          )}
          {zones.map(zone => (
            <WarehouseZoneRow key={zone.id} zone={zone} onSave={onSaveZone} onDelete={onDeleteZone} />
          ))}
          <AddZoneForm onAdd={(data) => onAddZone(warehouse.id, data)} />
        </div>
      )}
    </div>
  );
}