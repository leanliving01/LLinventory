import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { User, X, Search } from 'lucide-react';

export default function TeamMemberSelect({ members, onSelect, onCancel, station }) {
  const [search, setSearch] = useState('');

  const stationColors = {
    prep: 'bg-blue-500 hover:bg-blue-600',
    cook: 'bg-amber-500 hover:bg-amber-600',
    portion: 'bg-green-500 hover:bg-green-600',
  };
  const btnColor = stationColors[station] || stationColors.cook;

  const filtered = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.toLowerCase();
    return members.filter(m => m.name.toLowerCase().includes(q));
  }, [members, search]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h3 className="text-lg font-bold">Who is starting this task?</h3>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-border shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search team member..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
        </div>

        {/* Scrollable member list */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No team members assigned to this station.<br />
              Add members in Settings → Production.
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No members matching "{search}"
            </p>
          ) : (
            filtered.map(member => (
              <Button
                key={member.id}
                onClick={() => onSelect(member)}
                className={`w-full h-16 text-lg font-bold gap-3 rounded-xl text-white ${btnColor}`}
              >
                <User className="w-6 h-6" />
                {member.name}
              </Button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}