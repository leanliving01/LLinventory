import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pencil, ShieldCheck, UserX, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATION_META = {
  prep: { label: 'Prep', color: 'bg-blue-100 text-blue-700' },
  cook: { label: 'Cook', color: 'bg-amber-100 text-amber-700' },
  portion: { label: 'Portion', color: 'bg-green-100 text-green-700' },
  dispatch: { label: 'Dispatch', color: 'bg-purple-100 text-purple-700' },
};

export default function TeamMemberRow({ member, onEdit, onToggleActive }) {
  const stations = Array.isArray(member.stations) && member.stations.length > 0
    ? member.stations
    : member.station ? [member.station] : [];

  const isInactive = member.is_active === false;

  return (
    <div className={cn(
      "flex items-center gap-4 px-5 py-3.5 border-b border-border last:border-b-0 transition-colors",
      isInactive && "opacity-50 bg-muted/30"
    )}>
      {/* Name + manager badge */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold truncate">{member.name}</span>
          {member.is_manager && (
            <Badge className="bg-purple-100 text-purple-700 text-[10px] gap-0.5">
              <ShieldCheck className="w-2.5 h-2.5" /> Manager
            </Badge>
          )}
          {isInactive && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {member.is_manager && member.manager_pin && (
            <span className="text-[10px] text-muted-foreground">Mgr PIN: ••••</span>
          )}
          {member.is_manager && !member.manager_pin && (
            <span className="text-[10px] text-amber-600 font-medium">⚠ No mgr PIN</span>
          )}
          {stations.includes('dispatch') && member.pin && (
            <span className="text-[10px] text-muted-foreground">Pack PIN: ••••</span>
          )}
          {stations.includes('dispatch') && !member.pin && (
            <span className="text-[10px] text-amber-600 font-medium">⚠ No packing PIN</span>
          )}
        </div>
      </div>

      {/* Station badges */}
      <div className="flex gap-1.5 shrink-0">
        {stations.map(s => (
          <Badge key={s} className={cn("text-[10px]", STATION_META[s]?.color || 'bg-muted')}>
            {STATION_META[s]?.label || s}
          </Badge>
        ))}
        {stations.length === 0 && (
          <span className="text-[10px] text-muted-foreground italic">No station</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(member)}>
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", isInactive ? "text-green-600 hover:text-green-700" : "text-muted-foreground hover:text-destructive")}
          onClick={() => onToggleActive(member)}
        >
          {isInactive ? <UserCheck className="w-3.5 h-3.5" /> : <UserX className="w-3.5 h-3.5" />}
        </Button>
      </div>
    </div>
  );
}