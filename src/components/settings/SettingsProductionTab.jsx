import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Users, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import TeamMemberRow from './TeamMemberRow';
import TeamMemberEditModal from './TeamMemberEditModal';

const STATION_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'prep', label: 'Prep' },
  { id: 'cook', label: 'Cook' },
  { id: 'portion', label: 'Portion' },
  { id: 'dispatch', label: 'Dispatch' },
];

export default function SettingsProductionTab() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null); // null = closed, 'new' = add, or member object
  const [search, setSearch] = useState('');
  const [stationFilter, setStationFilter] = useState('all');
  const [showInactive, setShowInactive] = useState(false);

  const { data: allMembers = [], isLoading } = useQuery({
    queryKey: ['team-members-all'],
    queryFn: () => base44.entities.TeamMember.list('name', 200),
  });

  const getStations = (m) => {
    if (Array.isArray(m.stations) && m.stations.length > 0) return m.stations;
    if (m.station) return [m.station];
    return [];
  };

  const filtered = useMemo(() => {
    return allMembers.filter(m => {
      // Active filter
      if (!showInactive && m.is_active === false) return false;
      if (showInactive && m.is_active !== false) return false;
      // Search
      if (search && !m.name?.toLowerCase().includes(search.toLowerCase())) return false;
      // Station filter
      if (stationFilter !== 'all') {
        const stations = getStations(m);
        if (!stations.includes(stationFilter)) return false;
      }
      return true;
    });
  }, [allMembers, search, stationFilter, showInactive]);

  const activeCount = allMembers.filter(m => m.is_active !== false).length;
  const managerCount = allMembers.filter(m => m.is_active !== false && m.is_manager).length;
  const inactiveCount = allMembers.filter(m => m.is_active === false).length;

  const handleSave = async (data, memberId) => {
    if (memberId) {
      await base44.entities.TeamMember.update(memberId, data);
      toast.success(`${data.name} updated`);
    } else {
      await base44.entities.TeamMember.create({ ...data, is_active: true });
      toast.success(`${data.name} added to the team`);
    }
    queryClient.invalidateQueries({ queryKey: ['team-members-all'] });
    queryClient.invalidateQueries({ queryKey: ['team-members'] });
    queryClient.invalidateQueries({ queryKey: ['floor-team-members'] });
    setEditing(null);
  };

  const handleToggleActive = async (member) => {
    const newActive = member.is_active === false ? true : false;
    await base44.entities.TeamMember.update(member.id, { is_active: newActive });
    queryClient.invalidateQueries({ queryKey: ['team-members-all'] });
    queryClient.invalidateQueries({ queryKey: ['team-members'] });
    queryClient.invalidateQueries({ queryKey: ['floor-team-members'] });
    toast.success(newActive ? `${member.name} reactivated` : `${member.name} deactivated`);
  };

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Stats strip */}
      <div className="flex gap-4">
        <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-4 py-2.5">
          <Users className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">{activeCount}</span>
          <span className="text-xs text-muted-foreground">Active</span>
        </div>
        <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-4 py-2.5">
          <ShieldCheck className="w-4 h-4 text-purple-600" />
          <span className="text-sm font-semibold">{managerCount}</span>
          <span className="text-xs text-muted-foreground">Managers</span>
        </div>
        {inactiveCount > 0 && (
          <button
            onClick={() => setShowInactive(!showInactive)}
            className="flex items-center gap-2 bg-card border border-border rounded-lg px-4 py-2.5 hover:bg-muted/50 transition-colors"
          >
            <span className="text-sm font-semibold text-muted-foreground">{inactiveCount}</span>
            <span className="text-xs text-muted-foreground">{showInactive ? 'Showing inactive' : 'Inactive'}</span>
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search team members..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 bg-muted rounded-lg p-0.5">
          {STATION_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setStationFilter(f.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                stationFilter === f.id
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button onClick={() => setEditing('new')} className="gap-1.5">
          <Plus className="w-4 h-4" /> Add Member
        </Button>
      </div>

      {/* Member list */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {showInactive ? 'Inactive Members' : 'Lean Living Team'}
            </h3>
            <span className="text-xs text-muted-foreground">{filtered.length} member{filtered.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        {isLoading ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">Loading team...</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            {search || stationFilter !== 'all'
              ? 'No members match your filters'
              : showInactive
                ? 'No inactive members'
                : 'No team members yet — add your first one above'}
          </div>
        ) : (
          filtered.map(m => (
            <TeamMemberRow
              key={m.id}
              member={m}
              onEdit={() => setEditing(m)}
              onToggleActive={() => handleToggleActive(m)}
            />
          ))
        )}
      </div>

      {/* Edit / Add modal */}
      {editing && (
        <TeamMemberEditModal
          member={editing === 'new' ? null : editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}