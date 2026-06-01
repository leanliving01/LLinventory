import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, UserCircle } from 'lucide-react';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import { getUserPermissions } from '@/lib/permissions';

/**
 * Full-screen modal for selecting which packer is working.
 *
 * Shows the manually-configured Dispatch Team PLUS any app user who has packing access
 * (the `pick_lists` permission). That way granting someone a role with packing access
 * makes them selectable here automatically — no separate dispatch-team entry required.
 *
 * Props:
 *  - onSelect(member) — called with { id, name } when a name is tapped
 */
export default function PackerSelectModal({ onSelect }) {
  const customRoles = useCustomRoles();

  const { data: members = [], isLoading: loadingMembers } = useQuery({
    queryKey: ['dispatch-team-active'],
    queryFn: () => base44.entities.DispatchTeamMember.filter({ status: 'active' }, 'name', 100),
  });

  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['packer-eligible-users'],
    queryFn: () => base44.entities.User.filter({}, 'full_name', 300),
  });

  const isLoading = loadingMembers || loadingUsers;

  // Merge dispatch team + users-with-packing-access, deduped by name.
  const people = useMemo(() => {
    const list = [];
    const seen = new Set();
    const add = (id, name) => {
      const clean = (name || '').trim();
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) return;
      seen.add(key);
      list.push({ id, name: clean });
    };
    members.forEach(m => add(m.id, m.name));
    users.forEach(u => {
      const perms = getUserPermissions(u, customRoles);
      if (perms.pick_lists) add(u.id, u.full_name || u.email);
    });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [members, users, customRoles]);

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
      ) : people.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">No packers available.</p>
          <p className="text-xs text-muted-foreground mt-1">Add someone to the Dispatch Team in Settings, or give a user a role with packing access.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {people.map(m => (
            <button
              key={m.id}
              onClick={() => onSelect(m)}
              className="bg-card border-2 border-border rounded-2xl p-5 flex flex-col items-center gap-2 active:scale-[0.96] transition-transform hover:border-primary/50"
            >
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-xl font-bold text-primary">{m.name.charAt(0).toUpperCase()}</span>
              </div>
              <p className="font-semibold text-sm">{m.name}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
