import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { User, X, Search, Check, Users, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const REQUIRED_PORTIONING_MEMBERS = 3;

/**
 * Team member selection modal.
 * - Single-select (default): onSelect(member) called immediately on tap.
 * - Multi-select (multiSelect=true): checkbox-style, confirm button. onSelectMultiple([members]) on confirm.
 *   For portioning, 3 members required. Fewer allowed only with a reason note.
 */
export default function TeamMemberSelect({ members, onSelect, onSelectMultiple, onCancel, station, multiSelect = false }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [shortageReason, setShortageReason] = useState('');

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

  const isShort = multiSelect && selected.length > 0 && selected.length < REQUIRED_PORTIONING_MEMBERS;
  const canConfirm = selected.length > 0 && (!isShort || shortageReason.trim().length > 0);

  const handleConfirmMulti = () => {
    if (!canConfirm) return;
    onSelectMultiple(selected, isShort ? shortageReason.trim() : null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-lg font-bold">
              {multiSelect ? 'Select portioning team' : 'Who is starting this task?'}
            </h3>
            {multiSelect && (
              <p className="text-sm text-muted-foreground mt-0.5">({REQUIRED_PORTIONING_MEMBERS} members needed)</p>
            )}
          </div>
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
          <div className="px-6 py-4 border-t border-border shrink-0 space-y-3">
            {isShort && (
              <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <p className="text-sm font-medium">
                    Only {selected.length} of {REQUIRED_PORTIONING_MEMBERS} members selected — please provide a reason
                  </p>
                </div>
                <Textarea
                  placeholder="e.g. Staff member absent, short-staffed today..."
                  value={shortageReason}
                  onChange={e => setShortageReason(e.target.value)}
                  className="h-16 text-sm"
                  autoFocus
                />
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="flex-1 text-sm text-muted-foreground">
                {selected.length === 0
                  ? `Select ${REQUIRED_PORTIONING_MEMBERS} team members`
                  : <span className={cn("font-medium", selected.length >= REQUIRED_PORTIONING_MEMBERS ? "text-green-600" : "text-amber-600")}>
                      <Users className="w-4 h-4 inline mr-1" />{selected.length}/{REQUIRED_PORTIONING_MEMBERS} selected
                    </span>
                }
              </div>
              <Button
                onClick={handleConfirmMulti}
                disabled={!canConfirm}
                className={`gap-2 h-12 px-6 text-white ${btnColor}`}
              >
                <Check className="w-5 h-5" />
                Start Task
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}