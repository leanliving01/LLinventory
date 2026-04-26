import React from 'react';
import { Check, X } from 'lucide-react';

const PERMISSIONS = [
  { area: 'Dashboard', admin: true, ops_manager: true, kitchen_manager: true, kitchen: false, stock_controller: true, picker_packer: false, viewer: true },
  { area: 'Catalog (view)', admin: true, ops_manager: true, kitchen_manager: true, kitchen: false, stock_controller: true, picker_packer: false, viewer: true },
  { area: 'Catalog (edit)', admin: true, ops_manager: true, kitchen_manager: false, kitchen: false, stock_controller: false, picker_packer: false, viewer: false },
  { area: 'Recipes (view)', admin: true, ops_manager: true, kitchen_manager: true, kitchen: true, stock_controller: false, picker_packer: false, viewer: true },
  { area: 'Recipes (edit)', admin: true, ops_manager: true, kitchen_manager: true, kitchen: false, stock_controller: false, picker_packer: false, viewer: false },
  { area: 'Production Planning', admin: true, ops_manager: true, kitchen_manager: true, kitchen: false, stock_controller: false, picker_packer: false, viewer: true },
  { area: 'Production Runs', admin: true, ops_manager: true, kitchen_manager: true, kitchen: true, stock_controller: false, picker_packer: false, viewer: true },
  { area: 'Kitchen Tablet', admin: true, ops_manager: true, kitchen_manager: true, kitchen: true, stock_controller: false, picker_packer: false, viewer: false },
  { area: 'Pick Lists', admin: true, ops_manager: true, kitchen_manager: true, kitchen: false, stock_controller: true, picker_packer: true, viewer: false },
  { area: 'Wastage', admin: true, ops_manager: true, kitchen_manager: true, kitchen: true, stock_controller: false, picker_packer: false, viewer: true },
  { area: 'Stock Take', admin: true, ops_manager: true, kitchen_manager: false, kitchen: false, stock_controller: true, picker_packer: false, viewer: false },
  { area: 'Stock Transfers', admin: true, ops_manager: true, kitchen_manager: false, kitchen: false, stock_controller: true, picker_packer: false, viewer: false },
  { area: 'Receiving', admin: true, ops_manager: true, kitchen_manager: false, kitchen: false, stock_controller: true, picker_packer: false, viewer: false },
  { area: 'Purchase Orders', admin: true, ops_manager: true, kitchen_manager: false, kitchen: false, stock_controller: true, picker_packer: false, viewer: true },
  { area: 'Sales / Orders', admin: true, ops_manager: true, kitchen_manager: false, kitchen: false, stock_controller: false, picker_packer: true, viewer: true },
  { area: 'Customers', admin: true, ops_manager: true, kitchen_manager: false, kitchen: false, stock_controller: false, picker_packer: false, viewer: true },
  { area: 'Reports', admin: true, ops_manager: true, kitchen_manager: true, kitchen: false, stock_controller: true, picker_packer: false, viewer: true },
  { area: 'Cost Data (visible)', admin: true, ops_manager: true, kitchen_manager: false, kitchen: false, stock_controller: false, picker_packer: false, viewer: false },
  { area: 'Settings', admin: true, ops_manager: false, kitchen_manager: false, kitchen: false, stock_controller: false, picker_packer: false, viewer: false },
  { area: 'User Management', admin: true, ops_manager: false, kitchen_manager: false, kitchen: false, stock_controller: false, picker_packer: false, viewer: false },
];

const ROLE_LABELS = {
  admin: 'Admin',
  ops_manager: 'Ops Mgr',
  kitchen_manager: 'Kitchen Mgr',
  kitchen: 'Kitchen',
  stock_controller: 'Stock Ctrl',
  picker_packer: 'Pick/Pack',
  viewer: 'Viewer',
};

const ROLES = ['admin', 'ops_manager', 'kitchen_manager', 'kitchen', 'stock_controller', 'picker_packer', 'viewer'];

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
          {PERMISSIONS.map(perm => (
            <tr key={perm.area} className="hover:bg-muted/20">
              <td className="px-4 py-2 text-sm">{perm.area}</td>
              {ROLES.map(r => (
                <td key={r} className="text-center px-2 py-2">
                  {perm[r] ? (
                    <Check className="w-3.5 h-3.5 text-green-600 mx-auto" />
                  ) : (
                    <X className="w-3.5 h-3.5 text-gray-300 mx-auto" />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}