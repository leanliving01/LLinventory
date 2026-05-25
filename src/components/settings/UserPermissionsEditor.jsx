import React, { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Loader2, RotateCcw } from 'lucide-react';
import { PERMISSION_GROUPS, PERMISSION_KEYS, ROLE_DEFAULTS } from '@/lib/permissions';

const BUILT_IN_ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'ops_manager', label: 'Ops Manager' },
  { value: 'kitchen_manager', label: 'Kitchen Manager' },
  { value: 'kitchen', label: 'Kitchen Staff' },
  { value: 'stock_controller', label: 'Stock Controller' },
  { value: 'picker_packer', label: 'Picker / Packer' },
  { value: 'floor_operator', label: 'Floor Operator' },
  { value: 'viewer', label: 'Viewer' },
];

export default function UserPermissionsEditor({ role, permissions, onSave, saving, customRoles = [] }) {
  const [currentRole, setCurrentRole] = useState(role || 'viewer');
  const [perms, setPerms] = useState(() => {
    const defaults = getDefaults(role || 'viewer', customRoles);
    if (permissions) {
      try { return { ...defaults, ...JSON.parse(permissions) }; } catch {}
    }
    return { ...defaults };
  });

  function getDefaults(roleKey, cRoles) {
    if (ROLE_DEFAULTS[roleKey]) return ROLE_DEFAULTS[roleKey];
    const custom = (cRoles || customRoles).find(r => r.key === roleKey);
    if (custom?.permissions) return custom.permissions;
    return ROLE_DEFAULTS.viewer;
  }

  const handleRoleChange = (newRole) => {
    setCurrentRole(newRole);
    setPerms({ ...getDefaults(newRole) });
  };

  const togglePerm = (key) => {
    setPerms(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleGroup = (group) => {
    const keys = group.keys.map(k => k.key);
    const allOn = keys.every(k => perms[k]);
    const val = !allOn;
    setPerms(prev => {
      const next = { ...prev };
      keys.forEach(k => { next[k] = val; });
      return next;
    });
  };

  const resetToDefaults = () => {
    setPerms({ ...getDefaults(currentRole) });
  };

  const handleSave = () => {
    const defaults = getDefaults(currentRole);
    const overrides = {};
    for (const pk of PERMISSION_KEYS) {
      if (perms[pk.key] !== defaults[pk.key]) {
        overrides[pk.key] = perms[pk.key];
      }
    }
    const permString = Object.keys(overrides).length > 0 ? JSON.stringify(overrides) : '';
    onSave(currentRole, permString);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Role Template</label>
          <Select value={currentRole} onValueChange={handleRoleChange}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BUILT_IN_ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              {customRoles.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Custom Roles</div>
                  {customRoles.map(r => <SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>)}
                </>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2 mt-auto">
          <Button variant="outline" size="sm" onClick={resetToDefaults} className="gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" /> Reset to Defaults
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Changing the role loads its default permissions. Toggle individual areas below to customise.
        Click a group header to toggle all permissions in that group.
      </p>

      <div className="space-y-4">
        {PERMISSION_GROUPS.map(group => {
          const keys = group.keys.map(k => k.key);
          const onCount = keys.filter(k => perms[k]).length;
          return (
            <div key={group.group} className="border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => toggleGroup(group)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.group}</span>
                <span className="text-[10px] text-muted-foreground">{onCount}/{keys.length}</span>
              </button>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-0">
                {group.keys.map(pk => (
                  <label
                    key={pk.key}
                    className="flex items-center gap-2.5 px-4 py-2.5 border-t border-border hover:bg-muted/20 transition-colors cursor-pointer"
                  >
                    <Checkbox checked={!!perms[pk.key]} onCheckedChange={() => togglePerm(pk.key)} />
                    <span className="text-sm">{pk.label}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Permissions
        </Button>
      </div>
    </div>
  );
}