import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';

export default function SettingsDispatchTab() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('packer');

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['dispatch-team'],
    queryFn: () => base44.entities.DispatchTeamMember.filter({ status: 'active' }, 'name', 100),
  });

  const handleAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) { toast.error('Enter a name'); return; }
    await base44.entities.DispatchTeamMember.create({ name: trimmed, role: newRole, status: 'active' });
    queryClient.invalidateQueries({ queryKey: ['dispatch-team'] });
    setNewName('');
    toast.success(`Added ${trimmed}`);
  };

  const handleRemove = async (member) => {
    await base44.entities.DispatchTeamMember.update(member.id, { status: 'inactive' });
    queryClient.invalidateQueries({ queryKey: ['dispatch-team'] });
    toast.success(`Removed ${member.name}`);
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" /> Dispatch Team
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your packing / dispatch team members. Packers select their name when starting an order.
        </p>
      </div>

      {/* Add member form */}
      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Team member name..."
          className="flex-1 h-10"
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <Select value={newRole} onValueChange={setNewRole}>
          <SelectTrigger className="w-32 h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="packer">Packer</SelectItem>
            <SelectItem value="checker">Checker</SelectItem>
            <SelectItem value="dispatcher">Dispatcher</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={handleAdd} className="h-10 gap-1">
          <Plus className="w-4 h-4" /> Add
        </Button>
      </div>

      {/* Members list */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No team members added yet.</p>
      ) : (
        <div className="divide-y border rounded-lg">
          {members.map(m => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <p className="font-medium flex-1">{m.name}</p>
              <Badge variant="outline" className="text-xs capitalize">{m.role}</Badge>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleRemove(m)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}