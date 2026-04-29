import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { User, X, Search, Check, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Team member selection modal.
 * - Single-select (default): onSelect(member) called immediately on tap.
 * - Multi-select (multiSelect=true): checkbox-style, confirm button. onSelectMultiple([members]) on confirm.
 */
export default function TeamMemberSelect({ members, onSelect, onSelectMultiple, onCancel, station, multiSelect = false }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);

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

  const toggleMember = (member) => {
    setSelected(prev =>
      prev.find(m => m.id === member.id)
        ? prev.filter(m => m.id !== member.id)
        : [...prev, member]
    );
  };

  const handleConfirmMulti = () => {
    if (selected.length === 0) return;
    onSelectMultiple(selected);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h3 className="text-lg font-bold">
            {multiSelect ? 'Select portioning team' : 'Who is starting this task?'}
          </h3>
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
          ) : multiSelect ? (
            filtered.map(member => {
              const isSelected = selected.find(m => m.id === member.id);
              return (
                <button
                  key={member.id}
                  onClick={() => toggleMember(member)}
                  className={cn(
                    "w-full h-16 text-lg font-bold gap-3 rounded-xl flex items-center justify-center transition-all",
                    isSelected
                      ? `${btnColor} text-white ring-2 ring-offset-2 ring-primary`
                      : "bg-muted text-foreground hover:bg-muted/80"
                  )}
                >
                  {isSelected ? <Check className="w-6 h-6" /> : <User className="w-6 h-6" />}
                  {member.name}
                </button>
              );
            })
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

        {/* Multi-select confirm footer */}
        {multiSelect && (
          <div className="px-6 py-4 border-t border-border shrink-0 flex items-center gap-3">
            <div className="flex-1 text-sm text-muted-foreground">
              {selected.length === 0
                ? 'Tap to select team members'
                : <span className="font-medium text-foreground"><Users className="w-4 h-4 inline mr-1" />{selected.length} selected</span>
              }
            </div>
            <Button
              onClick={handleConfirmMulti}
              disabled={selected.length === 0}
              className={`gap-2 h-12 px-6 text-white ${btnColor}`}
            >
              <Check className="w-5 h-5" />
              Start Task
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}