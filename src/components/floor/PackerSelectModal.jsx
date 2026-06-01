import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, UserCircle } from 'lucide-react';

/**
 * Full-screen modal for selecting which packer is working.
 *
 * The list is the Production Team (Settings → Production Team) members who are assigned the
 * "Dispatch" station — i.e. who is allowed to pack/dispatch. It is independent of which user
 * is signed in on the tablet: the packer picks their own name from the dispatch team.
 *
 * Props:
 *  - onSelect(member) — called with the TeamMember { id, name } when a name is tapped
 */
export default function PackerSelectModal({ onSelect }) {
  const { data: allMembers = [], isLoading } = useQuery({
    queryKey: ['production-team'],
    queryFn: () => base44.entities.TeamMember.list('name', 200),
  });

  // Active team members assigned the Dispatch station.
  const packers = useMemo(() => allMembers.filter(m => {
    if (m.is_active === false) return false;
    const stations = Array.isArray(m.stations) && m.stations.length > 0
      ? m.stations
      : (m.station ? [m.station] : []);
    return stations.includes('dispatch');
  }), [allMembers]);

  return (
    <div className="space-y-5">
      <div className="text-center">
        <UserCircle className="w-12 h-12 text-primary mx-auto mb-2" />
        <h1 className="text-xl font-bold">Who is packing?</h1>
        <p className="text-sm text-muted-foreground mt-1">Select your name to continue</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading team...
        </div>
      ) : packers.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">No dispatch team members.</p>
          <p className="text-xs text-muted-foreground mt-1">Assign the <strong>Dispatch</strong> station to a team member in Settings → Production Team.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {packers.map(m => (
            <button
              key={m.id}
              onClick={() => onSelect(m)}
              className="bg-card border-2 border-border rounded-2xl p-5 flex flex-col items-center gap-2 active:scale-[0.96] transition-transform hover:border-primary/50"
            >
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-xl font-bold text-primary">{(m.name || '?').charAt(0).toUpperCase()}</span>
              </div>
              <p className="font-semibold text-sm">{m.name}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
