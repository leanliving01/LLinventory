import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X, Loader2, ShieldCheck, Utensils, Flame, ChefHat, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUnsavedChanges, useGuardedAction } from '@/lib/navigationGuard';

const STATIONS = [
  { id: 'prep', label: 'Prep', icon: Utensils, color: 'border-blue-300 bg-blue-50' },
  { id: 'cook', label: 'Cook', icon: Flame, color: 'border-amber-300 bg-amber-50' },
  { id: 'portion', label: 'Portion', icon: ChefHat, color: 'border-green-300 bg-green-50' },
  { id: 'dispatch', label: 'Dispatch', icon: Truck, color: 'border-purple-300 bg-purple-50' },
];

export default function TeamMemberEditModal({ member, onSave, onCancel }) {
  const isNew = !member;
  const [name, setName] = useState(member?.name || '');
  const [stations, setStations] = useState(() => {
    if (member?.stations?.length > 0) return [...member.stations];
    if (member?.station) return [member.station];
    return [];
  });
  const [isManager, setIsManager] = useState(member?.is_manager || false);
  const [pin, setPin] = useState(member?.manager_pin || '');
  const [packPin, setPackPin] = useState(member?.pin || '');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const guardedClose = useGuardedAction();

  // Baseline mirrors the exact init values above, so an untouched form is clean.
  const baseStations = member?.stations?.length > 0
    ? [...member.stations]
    : member?.station ? [member.station] : [];
  const isDirty =
    name !== (member?.name || '') ||
    JSON.stringify(stations) !== JSON.stringify(baseStations) ||
    isManager !== (member?.is_manager || false) ||
    pin !== (member?.manager_pin || '') ||
    packPin !== (member?.pin || '');
  useUnsavedChanges(isDirty, {
    message: 'You have unsaved team member changes. Leave without saving?',
  });

  const toggleStation = (sid) => {
    setStations(prev => prev.includes(sid) ? prev.filter(s => s !== sid) : [...prev, sid]);
  };

  const validate = () => {
    const e = {};
    if (!name.trim()) e.name = 'Name is required';
    if (stations.length === 0) e.stations = 'Select at least one station';
    if (isManager && pin && !/^\d{4}$/.test(pin)) e.pin = 'PIN must be exactly 4 digits';
    if (packPin && !/^\d{4}$/.test(packPin)) e.packPin = 'PIN must be exactly 4 digits';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    const data = {
      name: name.trim(),
      stations,
      is_manager: isManager,
      manager_pin: isManager ? pin : '',
      pin: packPin,
    };
    await onSave(data, member?.id);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-lg font-bold">{isNew ? 'Add Team Member' : 'Edit Team Member'}</h3>
          <Button variant="ghost" size="icon" onClick={() => guardedClose(onCancel)}><X className="w-5 h-5" /></Button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Name */}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Sipho, Thandi"
              className="mt-1.5"
              autoFocus
            />
            {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
          </div>

          {/* Stations */}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Duties</Label>
            <p className="text-[11px] text-muted-foreground mb-2">Select all duties this person handles</p>
            <div className="flex gap-3">
              {STATIONS.map(s => {
                const Icon = s.icon;
                const checked = stations.includes(s.id);
                return (
                  <label
                    key={s.id}
                    className={cn(
                      "flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 cursor-pointer transition-all text-center",
                      checked ? `${s.color} border-primary ring-1 ring-primary/30` : "border-border hover:border-muted-foreground/30"
                    )}
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggleStation(s.id)} className="sr-only" />
                    <Icon className="w-5 h-5" />
                    <span className="text-xs font-semibold">{s.label}</span>
                    {checked && <Badge className="bg-primary text-primary-foreground text-[9px]">✓</Badge>}
                  </label>
                );
              })}
            </div>
            {errors.stations && <p className="text-xs text-destructive mt-1">{errors.stations}</p>}
          </div>

          {/* Packing PIN — required for dispatch staff to identify themselves when packing */}
          {stations.includes('dispatch') && (
            <div className="bg-muted/40 rounded-xl p-4 space-y-2 border border-border">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-purple-600" />
                <Label className="text-sm font-semibold">Packing PIN</Label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                A 4-digit PIN this person enters when they pick their name to pack orders — so nobody packs under someone else's name.
              </p>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={4}
                pattern="\d{4}"
                value={packPin}
                onChange={e => setPackPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="e.g. 1234"
                className="mt-1 w-32 text-center text-lg font-mono tracking-[0.5em]"
              />
              {errors.packPin && <p className="text-xs text-destructive mt-1">{errors.packPin}</p>}
              {!packPin && <p className="text-[10px] text-amber-600 mt-1">No PIN set — this person won't be able to pack until you set one.</p>}
            </div>
          )}

          {/* Manager toggle */}
          <div className="bg-purple-50 dark:bg-purple-950/40 rounded-xl p-4 space-y-3 border border-purple-200 dark:border-purple-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-purple-600" />
                <Label className="text-sm font-semibold">Manager</Label>
              </div>
              <Switch checked={isManager} onCheckedChange={setIsManager} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Managers can approve production run completions with a PIN. They verify accuracy before finalizing.
            </p>

            {isManager && (
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">4-Digit PIN</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  pattern="\d{4}"
                  value={pin}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setPin(val);
                  }}
                  placeholder="e.g. 1234"
                  className="mt-1.5 w-32 text-center text-lg font-mono tracking-[0.5em]"
                />
                {errors.pin && <p className="text-xs text-destructive mt-1">{errors.pin}</p>}
                {!pin && <p className="text-[10px] text-amber-600 mt-1">Set a PIN so this manager can approve runs</p>}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1 gap-1.5" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {isNew ? 'Add Member' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}