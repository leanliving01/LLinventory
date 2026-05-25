import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Warehouse, Pencil, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import WarehouseZoneRow from './WarehouseZoneRow';
import AddZoneForm from './AddZoneForm';

export default function WarehouseCard({ warehouse, zones, onRenameWarehouse, onSaveZone, onDeleteZone, onAddZone }) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState(warehouse.name);

  const handleRename = () => {
    if (newName.trim() && newName.trim() !== warehouse.name) {
      onRenameWarehouse(warehouse.id, newName.trim());
    }
    setEditing(false);
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