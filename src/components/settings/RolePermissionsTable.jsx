import React from 'react';
import { Check, X } from 'lucide-react';
import { PERMISSION_GROUPS, ROLE_DEFAULTS } from '@/lib/permissions';

const ROLES = ['admin', 'ops_manager', 'kitchen_manager', 'kitchen', 'stock_controller', 'picker_packer', 'floor_operator', 'viewer'];
const ROLE_LABELS = {
  admin: 'Admin', ops_manager: 'Ops Mgr', kitchen_manager: 'Kitchen Mgr', kitchen: 'Kitchen',
  stock_controller: 'Stock Ctrl', picker_packer: 'Pick/Pack', floor_operator: 'Floor Op', viewer: 'Viewer',
};

export default function RolePermissionsTable() {
  return (
    <div className="overflow-x-auto border-t border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50">
            <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Area</th>
            {ROLES.map(r => (
              <th key={r} className="text-center px-2 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">
                {ROLE_LABELS[r]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {PERMISSION_GROUPS.map(group => (
            <React.Fragment key={group.group}>
              <tr className="bg-muted/20">
                <td colSpan={ROLES.length + 1} className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.group}
                </td>
              </tr>
              {group.keys.map(pk => (
                <tr key={pk.key} className="hover:bg-muted/20">
                  <td className="px-4 py-2 text-sm pl-6">{pk.label}</td>
                  {ROLES.map(r => (
                    <td key={r} className="text-center px-2 py-2">
                      {ROLE_DEFAULTS[r]?.[pk.key] ? (
                        <Check className="w-3.5 h-3.5 text-green-600 mx-auto" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-gray-300 mx-auto" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}