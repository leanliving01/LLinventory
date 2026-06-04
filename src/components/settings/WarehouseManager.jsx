import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Warehouse as WarehouseIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import WarehouseCard from './WarehouseCard';
import LocationAddressFields, { EMPTY_ADDRESS } from './LocationAddressFields';

export default function WarehouseManager() {
  const queryClient = useQueryClient();
  const [showAddWarehouse, setShowAddWarehouse] = useState(false);
  const [newWhName, setNewWhName] = useState('');
  const [newWhCode, setNewWhCode] = useState('');
  const [newWhAddress, setNewWhAddress] = useState(EMPTY_ADDRESS);
  const [creating, setCreating] = useState(false);

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ['locations-all'],
    queryFn: () => base44.entities.Location.list('name', 200),
  });

  // Warehouses = locations with no parent_location_id (except type=production which is standalone)
  const { warehouses, zonesByWarehouse } = useMemo(() => {
    const wh = locations.filter(l => !l.parent_location_id && l.type !== 'production');
    // Zones = locations with a parent_location_id
    const zones = locations.filter(l => l.parent_location_id);
    const map = {};
    wh.forEach(w => { map[w.id] = []; });
    zones.forEach(z => {
      if (map[z.parent_location_id]) {
        map[z.parent_location_id].push(z);
      }
    });
    // Sort zones by name within each warehouse
    Object.values(map).forEach(arr => arr.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    return { warehouses: wh, zonesByWarehouse: map };
  }, [locations]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['locations-all'] });

  const handleAddWarehouse = async () => {
    if (!newWhName.trim() || !newWhCode.trim()) return;
    setCreating(true);
    await base44.entities.Location.create({
      name: newWhName.trim(),
      code: newWhCode.trim().toUpperCase(),
      type: 'ambient',
      is_stock_bearing: true,
      parent_location_id: null,
      ...newWhAddress,
    });
    invalidate();
    toast.success(`Warehouse "${newWhName.trim()}" created`);
    setNewWhName('');
    setNewWhCode('');
    setNewWhAddress(EMPTY_ADDRESS);
    setShowAddWarehouse(false);
    setCreating(false);
  };

  const handleRenameWarehouse = async (id, newName) => {
    await base44.entities.Location.update(id, { name: newName });
    invalidate();
    toast.success('Warehouse renamed');
  };

  const handleSaveWarehouseAddress = async (id, address) => {
    await base44.entities.Location.update(id, address);
    invalidate();
    toast.success('Warehouse address saved');
  };

  const handleSaveZone = async (id, data) => {
    await base44.entities.Location.update(id, data);
    invalidate();
    toast.success('Zone updated');
  };

  const handleDeleteZone = async (id) => {
    await base44.entities.Location.delete(id);
    invalidate();
    toast.success('Zone removed');
  };

  const handleAddZone = async (warehouseId, data) => {
    await base44.entities.Location.create({
      ...data,
      parent_location_id: warehouseId,
      is_stock_bearing: data.type !== 'production',
    });
    invalidate();
    toast.success(`Zone "${data.name}" added`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading warehouses...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Warehouses & Zones</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {warehouses.length} warehouse{warehouses.length !== 1 ? 's' : ''} · {locations.filter(l => l.parent_location_id).length} zones
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowAddWarehouse(!showAddWarehouse)}>
          <Plus className="w-3.5 h-3.5" strokeWidth={1.5} /> Add Warehouse
        </Button>
      </div>

      {showAddWarehouse && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Warehouse Name</label>
              <Input value={newWhName} onChange={e => setNewWhName(e.target.value)} placeholder="e.g. Satellite Warehouse" className="h-9" />
            </div>
            <div className="w-24 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Code</label>
              <Input value={newWhCode} onChange={e => setNewWhCode(e.target.value.toUpperCase())} placeholder="SW" className="h-9 font-mono" maxLength={8} />
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-2">Physical Address (optional)</p>
            <LocationAddressFields value={newWhAddress} onChange={(k, v) => setNewWhAddress(prev => ({ ...prev, [k]: v }))} />
          </div>
          <div className="flex justify-end">
            <Button size="sm" className="h-9 gap-1.5" onClick={handleAddWarehouse} disabled={creating || !newWhName.trim() || !newWhCode.trim()}>
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <WarehouseIcon className="w-3.5 h-3.5" strokeWidth={1.5} />}
              Create
            </Button>
          </div>
        </div>
      )}

      {warehouses.map(wh => (
        <WarehouseCard
          key={wh.id}
          warehouse={wh}
          zones={zonesByWarehouse[wh.id] || []}
          onRenameWarehouse={handleRenameWarehouse}
          onSaveWarehouseAddress={handleSaveWarehouseAddress}
          onSaveZone={handleSaveZone}
          onDeleteZone={handleDeleteZone}
          onAddZone={handleAddZone}
        />
      ))}

      {warehouses.length === 0 && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No warehouses configured. Add one to get started.
        </div>
      )}
    </div>
  );
}