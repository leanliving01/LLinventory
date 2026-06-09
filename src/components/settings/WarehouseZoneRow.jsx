import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pencil, Trash2, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getZoneConfig } from '@/components/stock-take/ZoneSelector';

const ZONE_TYPES = [
  { value: 'ambient', label: 'Ambient / Dry' },
  { value: 'chilled', label: 'Chilled' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'packing', label: 'Packing' },
  { value: 'dispatch', label: 'Dispatch' },
  { value: 'production', label: 'Production' },
  { value: 'bin', label: 'Bin' },
  { value: 'shelf', label: 'Shelf' },
  { value: 'storage', label: 'Storage Area' },
];

export default function WarehouseZoneRow({ zone, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(zone.name);
  const [code, setCode] = useState(zone.code);
  const [type, setType] = useState(zone.type);
  const [stockBearing, setStockBearing] = useState(zone.is_stock_bearing);

  const config = getZoneConfig(zone.type);
  const Icon = config.icon;

  const handleSave = () => {
    onSave(zone.id, { name, code, type, is_stock_bearing: stockBearing });
    setEditing(false);
  };

  const handleCancel = () => {
    setName(zone.name);
    setCode(zone.code);
    setType(zone.type);
    setStockBearing(zone.is_stock_bearing);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="px-5 py-3 flex items-center gap-3 bg-muted/30">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Zone name" className="flex-1 h-8 text-sm" />
        <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="CODE" className="w-20 h-8 text-sm font-mono" maxLength={8} />
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-36 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ZONE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-status-good" onClick={handleSave}><Check className="w-4 h-4" strokeWidth={1.5} /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={handleCancel}><X className="w-4 h-4" strokeWidth={1.5} /></Button>
      </div>
    );
  }

  return (
    <div className="px-5 py-3 flex items-center gap-3 group hover:bg-muted/30 transition-colors">
      <div className={cn("w-7 h-7 rounded-md flex items-center justify-center shrink-0", config.bg)}>
        <Icon className={cn("w-3.5 h-3.5", config.text)} strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{zone.name}</p>
        <p className="text-[11px] text-muted-foreground">
          <span className="font-mono">{zone.code}</span> · {config.label}
          {!zone.is_stock_bearing && <span className="ml-1 text-status-warn">(non-stock)</span>}
        </p>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(true)}>
          <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => onDelete(zone.id)}>
          <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
        </Button>
      </div>
    </div>
  );
}