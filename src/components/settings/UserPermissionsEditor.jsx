import React, { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Loader2, RotateCcw } from 'lucide-react';
import { PERMISSION_KEYS, ROLE_DEFAULTS } from '@/lib/permissions';

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'ops_manager', label: 'Ops Manager' },
  { value: 'kitchen_manager', label: 'Kitchen Manager' },
  { value: 'kitchen', label: 'Kitchen Staff' },
  { value: 'stock_controller', label: 'Stock Controller' },
  { value: 'picker_packer', label: 'Picker / Packer' },
  { value: 'viewer', label: 'Viewer' },
];

export default function UserPermissionsEditor({ role, permissions, onSave, saving }) {
  const [currentRole, setCurrentRole] = useState(role || 'viewer');
  const [perms, setPerms] = useState(() => {
    const defaults = ROLE_DEFAULTS[role || 'viewer'] || ROLE_DEFAULTS.viewer;
    if (permissions) {
      try { return { ...defaults, ...JSON.parse(permissions) }; } catch {}
    }
    return { ...defaults };
  });

  const handleRoleChange = (newRole) => {
    setCurrentRole(newRole);
    setPerms({ ...(ROLE_DEFAULTS[newRole] || ROLE_DEFAULTS.viewer) });
  };

  const togglePerm = (key) => {
    setPerms(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const resetToDefaults = () => {
    setPerms({ ...(ROLE_DEFAULTS[currentRole] || ROLE_DEFAULTS.viewer) });
  };

  const handleSave = () => {
    // Only store overrides that differ from role defaults
    const defaults = ROLE_DEFAULTS[currentRole] || ROLE_DEFAULTS.viewer;
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
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
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
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {PERMISSION_KEYS.map(pk => (
          <label
            key={pk.key}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border hover:bg-muted/30 transition-colors cursor-pointer"
          >
            <Checkbox
              checked={!!perms[pk.key]}
              onCheckedChange={() => togglePerm(pk.key)}
            />
            <span className="text-sm">{pk.label}</span>
          </label>
        ))}
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