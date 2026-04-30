import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Save, Trash2, Loader2, Tag, X, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSION_KEYS, ROLE_DEFAULTS } from '@/lib/permissions';

/**
 * Manages custom roles stored as Setting records (group=org, key=custom_role_<slug>).
 * Each role has a display name, a slug key, and a permissions object.
 */
export default function CustomRolesManager() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [roleName, setRoleName] = useState('');
  const [perms, setPerms] = useState({});
  const [saving, setSaving] = useState(false);

  const { data: customRoleSettings = [] } = useQuery({
    queryKey: ['custom-roles'],
    queryFn: async () => {
      const all = await base44.entities.Setting.filter({ group: 'org' }, 'key', 100);
      return all.filter(s => s.key?.startsWith('custom_role_'));
    },
  });

  const parseRole = (setting) => {
    try { return JSON.parse(setting.value); } catch { return null; }
  };

  const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  const startNew = () => {
    setEditingId(null);
    setRoleName('');
    // Start with viewer defaults
    setPerms({ ...ROLE_DEFAULTS.viewer });
    setShowForm(true);
  };

  const startEdit = (setting) => {
    const role = parseRole(setting);
    if (!role) return;
    setEditingId(setting.id);
    setRoleName(role.name);
    setPerms({ ...ROLE_DEFAULTS.viewer, ...(role.permissions || {}) });
    setShowForm(true);
  };

  const togglePerm = (key) => setPerms(prev => ({ ...prev, [key]: !prev[key] }));

  const handleSave = async () => {
    if (!roleName.trim()) { toast.error('Enter a role name'); return; }
    setSaving(true);
    const slug = slugify(roleName.trim());
    const settingKey = `custom_role_${slug}`;
    const roleData = { name: roleName.trim(), key: slug, permissions: perms };

    if (editingId) {
      await base44.entities.Setting.update(editingId, {
        value: JSON.stringify(roleData),
        label: roleName.trim(),
      });
    } else {
      // Check for duplicate key
      const existing = customRoleSettings.find(s => s.key === settingKey);
      if (existing) {
        toast.error('A role with that name already exists');
        setSaving(false);
        return;
      }
      await base44.entities.Setting.create({
        key: settingKey,
        value: JSON.stringify(roleData),
        group: 'org',
        label: roleName.trim(),
      });
    }

    queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
    toast.success(editingId ? 'Role updated' : 'Role created');
    setShowForm(false);
    setSaving(false);
  };

  const handleDelete = async (setting) => {
    await base44.entities.Setting.delete(setting.id);
    queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
    toast.success('Role deleted');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Tag className="w-4 h-4" /> Custom Roles
        </h3>
        {!showForm && (
          <Button size="sm" onClick={startNew} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New Role
          </Button>
        )}
      </div>

      {/* Existing custom roles */}
      {customRoleSettings.length > 0 && !showForm && (
        <div className="space-y-2">
          {customRoleSettings.map(setting => {
            const role = parseRole(setting);
            if (!role) return null;
            const enabledCount = Object.values(role.permissions || {}).filter(Boolean).length;
            return (
              <div key={setting.id} className="flex items-center justify-between px-4 py-3 bg-muted/30 rounded-xl border border-border">
                <div>
                  <p className="text-sm font-semibold">{role.name}</p>
                  <p className="text-[10px] text-muted-foreground">{enabledCount}/{PERMISSION_KEYS.length} permissions · key: {role.key}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => startEdit(setting)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="w-8 h-8 text-destructive" onClick={() => handleDelete(setting)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {customRoleSettings.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground">No custom roles yet. Create one to reuse across team members.</p>
      )}

      {/* Create / Edit form */}
      {showForm && (
        <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">{editingId ? 'Edit Role' : 'Create New Role'}</h4>
            <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setShowForm(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Role Name</label>
            <Input
              placeholder="e.g. Dispatch Manager, Senior Chef"
              value={roleName}
              onChange={e => setRoleName(e.target.value)}
              className="max-w-sm"
            />
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-2">Permissions for this role:</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PERMISSION_KEYS.map(pk => (
                <label
                  key={pk.key}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <Checkbox checked={!!perms[pk.key]} onCheckedChange={() => togglePerm(pk.key)} />
                  <span className="text-sm">{pk.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId ? 'Update Role' : 'Save Role'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Hook to get parsed custom roles for use in other components */
export function useCustomRoles() {
  const { data: settings = [] } = useQuery({
    queryKey: ['custom-roles'],
    queryFn: async () => {
      const all = await base44.entities.Setting.filter({ group: 'org' }, 'key', 100);
      return all.filter(s => s.key?.startsWith('custom_role_'));
    },
  });

  return settings.map(s => {
    try { return JSON.parse(s.value); } catch { return null; }
  }).filter(Boolean);
}