import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Utensils, Flame, ChefHat, Plus, Trash2, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

const STATION_META = {
  prep: { label: 'Prep', icon: Utensils, color: 'bg-blue-100 text-blue-700' },
  cook: { label: 'Cook', icon: Flame, color: 'bg-amber-100 text-amber-700' },
  portion: { label: 'Portion', icon: ChefHat, color: 'bg-green-100 text-green-700' },
};

const DEDUCTION_OPTIONS = [
  { value: 'cook_task_complete', label: "After each 'Cook' task is completed", description: "Raw materials are deducted immediately when a cook task is marked done." },
  { value: 'pick_list_fulfilled', label: "When the pick list is marked fulfilled", description: "Raw materials are deducted once the pick list for the run is fulfilled." },
  { value: 'production_run_complete', label: "Only when the entire Production Run is completed", description: "Raw materials are deducted when the run is finalised (current default)." },
];

export default function SettingsProductionTab() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newStation, setNewStation] = useState('prep');
  const [saving, setSaving] = useState(false);
  const [savingDeduction, setSavingDeduction] = useState(false);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['team-members'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }, 'name', 100),
  });

  const { data: settings = [] } = useQuery({
    queryKey: ['settings'],
    queryFn: () => base44.entities.Setting.list('-created_date', 100),
  });

  const deductionSetting = useMemo(() => {
    const s = settings.find(s => s.key === 'inventory_deduction_timing');
    return s?.value || 'production_run_complete';
  }, [settings]);

  const membersByStation = useMemo(() => {
    const grouped = { prep: [], cook: [], portion: [] };
    members.forEach(m => {
      if (grouped[m.station]) grouped[m.station].push(m);
    });
    return grouped;
  }, [members]);

  const handleAddMember = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    await base44.entities.TeamMember.create({ name: newName.trim(), station: newStation, is_active: true });
    queryClient.invalidateQueries({ queryKey: ['team-members'] });
    setNewName('');
    toast.success(`${newName.trim()} added to ${STATION_META[newStation].label}`);
    setSaving(false);
  };

  const handleRemoveMember = async (member) => {
    await base44.entities.TeamMember.update(member.id, { is_active: false });
    queryClient.invalidateQueries({ queryKey: ['team-members'] });
    toast.success(`${member.name} removed`);
  };

  const handleDeductionChange = async (value) => {
    setSavingDeduction(true);
    const existing = settings.find(s => s.key === 'inventory_deduction_timing');
    if (existing) {
      await base44.entities.Setting.update(existing.id, { value });
    } else {
      await base44.entities.Setting.create({
        key: 'inventory_deduction_timing',
        value,
        group: 'production',
        label: 'Inventory Deduction Timing',
      });
    }
    queryClient.invalidateQueries({ queryKey: ['settings'] });
    toast.success('Deduction timing updated');
    setSavingDeduction(false);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Inventory Deduction Timing */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">Inventory Deduction for Production</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Choose when raw materials are deducted from stock during a production run.</p>
        </div>
        <div className="p-6 space-y-3">
          {DEDUCTION_OPTIONS.map(opt => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                deductionSetting === opt.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/30'
              }`}
              onClick={() => handleDeductionChange(opt.value)}
            >
              <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                deductionSetting === opt.value ? 'border-primary' : 'border-muted-foreground/40'
              }`}>
                {deductionSetting === opt.value && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
              </div>
              <div>
                <p className="text-sm font-medium">{opt.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
              </div>
            </label>
          ))}
          {savingDeduction && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving...</p>}
        </div>
      </div>

      {/* Team Members */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">Kitchen Team</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Assign team members to stations. They'll select their name when starting a task.</p>
        </div>

        {/* Add member */}
        <div className="px-6 py-4 border-b border-border flex items-center gap-3">
          <Input
            placeholder="Team member name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="flex-1"
            onKeyDown={e => e.key === 'Enter' && handleAddMember()}
          />
          <Select value={newStation} onValueChange={setNewStation}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="prep">Prep</SelectItem>
              <SelectItem value="cook">Cook</SelectItem>
              <SelectItem value="portion">Portion</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleAddMember} disabled={saving || !newName.trim()} size="sm" className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add
          </Button>
        </div>

        {/* Members by station */}
        <div className="divide-y divide-border">
          {['prep', 'cook', 'portion'].map(station => {
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
                    {stationMembers.map(m => (
                      <div key={m.id} className="flex items-center gap-1.5 bg-muted px-3 py-1.5 rounded-lg text-sm">
                        <span>{m.name}</span>
                        <button
                          onClick={() => handleRemoveMember(m)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
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