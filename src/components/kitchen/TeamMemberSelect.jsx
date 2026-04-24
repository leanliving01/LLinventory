import React from 'react';
import { Button } from '@/components/ui/button';
import { User, X } from 'lucide-react';

export default function TeamMemberSelect({ members, onSelect, onCancel, station }) {
  const stationColors = {
    prep: 'bg-blue-500 hover:bg-blue-600',
    cook: 'bg-amber-500 hover:bg-amber-600',
    portion: 'bg-green-500 hover:bg-green-600',
  };
  const btnColor = stationColors[station] || stationColors.cook;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-lg font-bold">Who is starting this task?</h3>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>
        <div className="p-6 space-y-3">
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No team members assigned to this station.<br />
              Add members in Settings → Production.
            </p>
          ) : (
            members.map(member => (
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