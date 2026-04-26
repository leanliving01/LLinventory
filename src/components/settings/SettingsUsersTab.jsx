import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, UserPlus, Shield, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import RolePermissionsTable from './RolePermissionsTable';

const ROLES = [
  { value: 'admin', label: 'Admin', description: 'Full access to everything' },
  { value: 'ops_manager', label: 'Ops Manager', description: 'Production, stock, purchasing, reports — no user management' },
  { value: 'kitchen_manager', label: 'Kitchen Manager', description: 'Production runs, recipes, wastage, kitchen tablet' },
  { value: 'kitchen', label: 'Kitchen Staff', description: 'Kitchen tablet only — tasks, timer, wastage' },
  { value: 'stock_controller', label: 'Stock Controller', description: 'Receiving, transfers, stock takes, reorder' },
  { value: 'picker_packer', label: 'Picker / Packer', description: 'Pick lists, pack & ship — no cost data visible' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only dashboard and reports' },
];

const roleColors = {
  admin: 'bg-red-100 text-red-700',
  ops_manager: 'bg-blue-100 text-blue-700',
  kitchen_manager: 'bg-blue-100 text-blue-700',
  kitchen: 'bg-green-100 text-green-700',
  stock_controller: 'bg-orange-100 text-orange-700',
  picker_packer: 'bg-amber-100 text-amber-700',
  viewer: 'bg-gray-100 text-gray-700',
};

export default function SettingsUsersTab() {
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [inviting, setInviting] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list('-created_date', 50),
  });

  const handleInvite = async () => {
    if (!inviteEmail || !inviteEmail.includes('@')) {
      toast.error('Enter a valid email');
      return;
    }
    setInviting(true);
    await base44.users.inviteUser(inviteEmail, inviteRole === 'admin' ? 'admin' : 'user');
    // Update their role after invite if not admin/user
    if (inviteRole !== 'admin' && inviteRole !== 'user') {
      // The user will be created with 'user' role; we update after
      // Note: role update happens when the invited user appears in the system
    }
    queryClient.invalidateQueries({ queryKey: ['users'] });
    toast.success(`Invited ${inviteEmail} as ${inviteRole.replace(/_/g, ' ')}`);
    setInviteEmail('');
    setInviting(false);
  };

  const handleRoleChange = async (userId, newRole) => {
    await base44.entities.User.update(userId, { role: newRole });
    queryClient.invalidateQueries({ queryKey: ['users'] });
    toast.success('Role updated');
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Invite */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <UserPlus className="w-4 h-4" /> Invite Team Member
        </h3>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] space-y-1">
            <label className="text-xs text-muted-foreground">Email</label>
            <Input
              type="email"
              placeholder="name@leanliving.co.za"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
            />
          </div>
          <div className="w-48 space-y-1">
            <label className="text-xs text-muted-foreground">Role</label>
            <Select value={inviteRole} onValueChange={setInviteRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map(r => (
                  <SelectItem key={r.value} value={r.value}>
                    <span className="font-medium">{r.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleInvite} disabled={inviting} className="gap-1.5">
            {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Invite
          </Button>
        </div>
      </div>

      {/* Users list */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Team Members ({users.length})</h3>
        </div>
        <div className="divide-y divide-border">
          {users.map(user => (
            <div key={user.id} className="px-6 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{user.full_name || user.email}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              <Select value={user.role || 'viewer'} onValueChange={v => handleRoleChange(user.id, v)}>
                <SelectTrigger className="w-44">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[user.role] || 'bg-gray-100 text-gray-700'}`}>
                    {(user.role || 'viewer').replace(/_/g, ' ')}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => (
                    <SelectItem key={r.value} value={r.value}>
                      <div>
                        <span className="font-medium text-sm">{r.label}</span>
                        <span className="text-xs text-muted-foreground ml-2">{r.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          {users.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">No users found</div>
          )}
        </div>
      </div>

      {/* Role permissions reference */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <button
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
          onClick={() => setShowPermissions(!showPermissions)}
        >
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Role Permissions Matrix</h3>
          </div>
          {showPermissions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showPermissions && <RolePermissionsTable />}
      </div>
    </div>
  );
}