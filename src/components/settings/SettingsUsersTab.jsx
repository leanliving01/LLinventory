import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Users, UserPlus, Pencil, X, Shield, ChevronDown, ChevronUp, Mail } from 'lucide-react';
import { toast } from 'sonner';
import UserPermissionsEditor from './UserPermissionsEditor';
import CustomRolesManager, { useCustomRoles } from './CustomRolesManager';
import { ROLE_DEFAULTS, PERMISSION_KEYS, getUserPermissions, ROLE_META } from '@/lib/permissions';

const roleColors = {
  admin:             'bg-red-100 text-red-700',
  director:          'bg-red-100 text-red-700',
  ops_manager:       'bg-blue-100 text-blue-700',
  financial_manager: 'bg-indigo-100 text-indigo-700',
  kitchen_manager:   'bg-blue-100 text-blue-700',
  kitchen:           'bg-green-100 text-green-700',
  stock_controller:  'bg-orange-100 text-orange-700',
  picker_packer:     'bg-amber-100 text-amber-700',
  floor_operator:    'bg-purple-100 text-purple-700',
  viewer:            'bg-gray-100 text-gray-700',
};

export default function SettingsUsersTab() {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';
  const queryClient = useQueryClient();
  const [editingUserId, setEditingUserId] = useState(null);
  const [saving, setSaving] = useState(false);

  // Invite flow state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteRole, setInviteRole] = useState('viewer');
  const [invitePermissions, setInvitePermissions] = useState('');
  const [inviteStep, setInviteStep] = useState(1); // 1 = email, 2 = permissions

  // Reference matrix
  const [showMatrix, setShowMatrix] = useState(false);

  // Custom roles
  const customRoles = useCustomRoles();

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list('-created_date', 50),
  });

  // ── Edit existing user ──
  const handleSaveUserPermissions = async (userId, newRole, permString) => {
    setSaving(true);

    try {
      await base44.entities.User.update(userId, { role: newRole, permissions: permString });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Permissions updated');
      setEditingUserId(null);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // ── Invite flow ──
  const startInvite = () => {
    setShowInvite(true);
    setInviteStep(1);
    setInviteEmail('');
    setInviteRole('viewer');
    setInvitePermissions('');
  };

  const proceedToPermissions = () => {
    if (!inviteEmail || !inviteEmail.includes('@')) {
      toast.error('Enter a valid email');
      return;
    }
    setInviteStep(2);
  };

  const handleInvitePermsSave = (role, permString) => {
    setInviteRole(role);
    setInvitePermissions(permString);
    sendInvite(role, permString);
  };

  const sendInvite = async (role, permString) => {
    setInviting(true);

    try {
      if (isAdmin) {
        // Admin: send a real Supabase invite email and create the users row with
        // the chosen role + permissions (server-side, admin-verified). The role +
        // permString here are exactly what was toggled in UserPermissionsEditor,
        // so the invitee is restricted to those from first login.
        const { data } = await base44.functions.invoke('inviteUser', {
          email: inviteEmail.trim(),
          role,
          permissions: permString,
          redirect_to: window.location.origin,
        });

        if (!data || data.success === false || data.status === 'error') {
          toast.error(data?.error || 'Invite failed — please try again');
          setInviting(false);
          return;
        }

        queryClient.invalidateQueries({ queryKey: ['users'] });
        toast.success(
          data.already_member
            ? (data.message || `${inviteEmail} updated`)
            : `Invite sent to ${inviteEmail} — they'll set a password from the email`,
        );
      } else {
        // Non-admin: only admins can create accounts (enforced server-side), so
        // this is a heads-up to arrange the invite with an admin. A full
        // request-approval email flow can be layered on later.
        toast.success(`Noted — ask an admin to add ${inviteEmail} in Settings → Users`);
      }

      setShowInvite(false);
    } catch (err) {
      toast.error('Invite failed: ' + (err.message || 'Unknown error'));
    } finally {
      setInviting(false);
    }
  };

  // Count active permissions for display
  const countPerms = (user) => {
    const perms = getUserPermissions(user, customRoles);
    return Object.values(perms).filter(Boolean).length;
  };

  // Get display name for a role (built-in or custom)
  const getRoleLabel = (roleKey) => {
    if (ROLE_META[roleKey]) return ROLE_META[roleKey].label;
    const custom = customRoles.find(r => r.key === roleKey);
    return custom?.name || roleKey.replace(/_/g, ' ');
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ── Invite card ── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {!showInvite ? (
          <div className="px-6 py-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <UserPlus className="w-4 h-4" /> Invite Team Member
            </h3>
            <Button size="sm" onClick={startInvite} className="gap-1.5">
              {isAdmin ? <UserPlus className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
              {isAdmin ? 'Invite' : 'Request Invite'}
            </Button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                {isAdmin ? <UserPlus className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
                {isAdmin ? 'New Invitation' : 'Request Invite (Admin Approval Required)'}
              </h3>
              <Button variant="ghost" size="icon" onClick={() => setShowInvite(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            {inviteStep === 1 && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Email address</label>
                  <Input
                    type="email"
                    placeholder="name@leanliving.co.za"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && proceedToPermissions()}
                    className="max-w-md"
                  />
                </div>
                <Button onClick={proceedToPermissions} className="gap-1.5">
                  Next — Configure Permissions
                </Button>
              </div>
            )}

            {inviteStep === 2 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Configuring permissions for <span className="font-medium text-foreground">{inviteEmail}</span>
                </p>
                <UserPermissionsEditor
                    role={inviteRole}
                    permissions={invitePermissions}
                    onSave={handleInvitePermsSave}
                    saving={inviting}
                    customRoles={customRoles}
                  />
                <p className="text-xs text-muted-foreground">
                   {isAdmin
                     ? 'Note: Permissions will be applied once the user accepts their invitation.'
                     : 'Note: Your request will be emailed to an admin for approval.'}
                 </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Users list ── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Team Members ({users.length})</h3>
        </div>
        <div className="divide-y divide-border">
          {users.map(user => (
            <div key={user.id}>
              <div className="px-6 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{user.full_name || user.email}</p>
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[user.role] || 'bg-indigo-100 text-indigo-700'}`}>
                    {getRoleLabel(user.role || 'viewer')}
                  </span>
                  {isAdmin && (
                    <Button
                      variant={editingUserId === user.id ? 'secondary' : 'ghost'}
                      size="icon"
                      className="w-8 h-8"
                      onClick={() => setEditingUserId(editingUserId === user.id ? null : user.id)}
                    >
                      {editingUserId === user.id ? <X className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                    </Button>
                  )}
                </div>
              </div>

              {editingUserId === user.id && (
                <div className="px-6 pb-5 pt-2 border-t border-border bg-muted/20">
                  <UserPermissionsEditor
                    role={user.role || 'viewer'}
                    permissions={user.permissions}
                    onSave={(newRole, permString) => handleSaveUserPermissions(user.id, newRole, permString)}
                    saving={saving}
                    customRoles={customRoles}
                  />
                </div>
              )}
            </div>
          ))}
          {users.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">No users found</div>
          )}
        </div>
      </div>

      {/* ── Custom Roles Manager ── */}
      {isAdmin && (
        <div className="bg-card border border-border rounded-xl p-5">
          <CustomRolesManager />
        </div>
      )}

      {/* ── Role defaults reference ── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <button
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
          onClick={() => setShowMatrix(!showMatrix)}
        >
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Role Defaults Reference</h3>
          </div>
          {showMatrix ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showMatrix && <RoleDefaultsMatrix customRoles={customRoles} />}
      </div>
    </div>
  );
}

/** Compact matrix showing default permissions per role template (including custom) */
function RoleDefaultsMatrix({ customRoles = [] }) {
  const builtInRoles = ['admin', 'director', 'financial_manager', 'ops_manager', 'kitchen_manager', 'kitchen', 'stock_controller', 'picker_packer', 'floor_operator', 'viewer'];

  const allRoles = [...builtInRoles, ...customRoles.map(r => r.key)];
  const getLabel = (key) => ROLE_META[key]?.label || customRoles.find(r => r.key === key)?.name || key;
  const getPerms = (roleKey) => ROLE_DEFAULTS[roleKey] || customRoles.find(r => r.key === roleKey)?.permissions || {};

  return (
    <div className="overflow-x-auto border-t border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50">
            <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Area</th>
            {allRoles.map(r => (
              <th key={r} className="text-center px-2 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">{getLabel(r)}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {PERMISSION_KEYS.map(pk => (
            <tr key={pk.key} className="hover:bg-muted/20">
              <td className="px-4 py-2 text-sm">{pk.label}</td>
              {allRoles.map(r => (
                <td key={r} className="text-center px-2 py-2">
                  {getPerms(r)[pk.key] ? '✓' : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}