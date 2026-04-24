import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Utensils, Flame, ChefHat, Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const STATION_META = {
  prep: { label: 'Prep', icon: Utensils, color: 'bg-blue-100 text-blue-700' },
  cook: { label: 'Cook', icon: Flame, color: 'bg-amber-100 text-amber-700' },
  portion: { label: 'Portion', icon: ChefHat, color: 'bg-green-100 text-green-700' },
};

const STATION_IDS = ['prep', 'cook', 'portion'];

export default function SettingsProductionTab() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newStations, setNewStations] = useState([]);
  const [saving, setSaving] = useState(false);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['team-members'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }, 'name', 100),
  });

  // Support both old `station` (string) and new `stations` (array) field
  const getStations = (m) => {
    if (Array.isArray(m.stations) && m.stations.length > 0) return m.stations;
    if (m.station) return [m.station];
    return [];
  };

  const membersByStation = useMemo(() => {
    const grouped = { prep: [], cook: [], portion: [] };
    members.forEach(m => {
      const stations = getStations(m);
      stations.forEach(s => {
        if (grouped[s]) grouped[s].push(m);
      });
    });
    return grouped;
  }, [members]);

  const toggleNewStation = (stationId) => {
    setNewStations(prev =>
      prev.includes(stationId) ? prev.filter(s => s !== stationId) : [...prev, stationId]
    );
  };

  const handleAddMember = async () => {
    if (!newName.trim()) return;
    if (newStations.length === 0) {
      toast.error('Select at least one station');
      return;
    }
    setSaving(true);
    await base44.entities.TeamMember.create({ name: newName.trim(), stations: newStations, is_active: true });
    queryClient.invalidateQueries({ queryKey: ['team-members'] });
    const stationLabels = newStations.map(s => STATION_META[s].label).join(', ');
    setNewName('');
    setNewStations([]);
    toast.success(`${newName.trim()} added to ${stationLabels}`);
    setSaving(false);
  };

  const handleRemoveMember = async (member) => {
    await base44.entities.TeamMember.update(member.id, { is_active: false });
    queryClient.invalidateQueries({ queryKey: ['team-members'] });
    toast.success(`${member.name} removed`);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Team Members */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">Kitchen Team</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Assign team members to one or more stations. They'll select their name when starting a task.</p>
        </div>

        {/* Add member */}
        <div className="px-6 py-4 border-b border-border space-y-3">
          <div className="flex items-center gap-3">
            <Input
              placeholder="Team member name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="flex-1"
              onKeyDown={e => e.key === 'Enter' && handleAddMember()}
            />
            <Button onClick={handleAddMember} disabled={saving || !newName.trim() || newStations.length === 0} size="sm" className="gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add
            </Button>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">Stations:</span>
            {STATION_IDS.map(sid => {
              const meta = STATION_META[sid];
              const Icon = meta.icon;
              const checked = newStations.includes(sid);
              return (
                <label
                  key={sid}
                  className={cn(
                    "flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg border transition-all text-sm",
                    checked ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"
                  )}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleNewStation(sid)}
                  />
                  <Icon className="w-3.5 h-3.5" />
                  <span className="font-medium">{meta.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Members by station */}
        <div className="divide-y divide-border">
          {STATION_IDS.map(station => {
            const meta = STATION_META[station];
            const stationMembers = membersByStation[station] || [];
            return (
              <div key={station} className="px-6 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <Badge className={meta.color}>{meta.label}</Badge>
                  <span className="text-xs text-muted-foreground">{stationMembers.length} members</span>
                </div>
                {stationMembers.length === 0 ? (
                  <p className="text-xs text-muted-foreground ml-1">No team members assigned</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {stationMembers.map(m => {
                      const otherStations = getStations(m).filter(s => s !== station);
                      return (
                        <div key={m.id} className="flex items-center gap-1.5 bg-muted px-3 py-1.5 rounded-lg text-sm">
                          <span>{m.name}</span>
                          {otherStations.length > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              (+{otherStations.map(s => STATION_META[s].label).join(', ')})
                            </span>
                          )}
                          <button
                            onClick={() => handleRemoveMember(m)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}