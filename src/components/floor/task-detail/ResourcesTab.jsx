import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Wrench } from 'lucide-react';

/**
 * "Resources" tab — shows equipment assigned to this task + BOM operations equipment.
 */
export default function ResourcesTab({ task, operations }) {
  // Collect unique equipment IDs from task + operations
  const equipmentIds = useMemo(() => {
    const ids = new Set();
    if (task.equipment_id) ids.add(task.equipment_id);
    (operations || []).forEach(op => { if (op.equipment_id) ids.add(op.equipment_id); });
    return [...ids];
  }, [task, operations]);

  // Fetch equipment details
  const { data: allEquipment = [] } = useQuery({
    queryKey: ['equipment-list'],
    queryFn: () => base44.entities.Equipment.filter({ status: 'active' }, 'name', 100),
  });

  const equipment = useMemo(() => {
    if (equipmentIds.length === 0) return [];
    return equipmentIds.map(id => allEquipment.find(e => e.id === id)).filter(Boolean);
  }, [equipmentIds, allEquipment]);

  // Also show task-level equipment name as fallback
  const taskEquipName = task.equipment_name;

  if (equipment.length === 0 && !taskEquipName) {
    return (
      <div className="text-center py-10">
        <p className="text-muted-foreground text-sm">No equipment assigned to this task.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {equipment.map(eq => (
        <div key={eq.id} className="bg-card border rounded-2xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0">
            <Wrench className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm">{eq.name}</p>
            <p className="text-xs text-muted-foreground">{eq.equipment_type}</p>
            {eq.default_capacity && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Capacity: {eq.default_capacity} {eq.default_capacity_uom}
                {eq.tray_count ? ` · ${eq.tray_count} trays` : ''}
              </p>
            )}
          </div>
          {eq.status === 'maintenance' && (
            <Badge className="bg-amber-100 text-amber-700 text-xs">Maintenance</Badge>
          )}
        </div>
      ))}

      {/* Fallback: if task has equipment_name but no matched equipment entity */}
      {equipment.length === 0 && taskEquipName && (
        <div className="bg-card border rounded-2xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0">
            <Wrench className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm">{taskEquipName}</p>
          </div>
        </div>
      )}
    </div>
  );
}