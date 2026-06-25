import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Settings as SettingsIcon, Users, ShoppingCart, Database } from 'lucide-react';

export default function Settings() {
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list('-created_date', 50),
  });

  const { data: skus = [] } = useQuery({
    queryKey: ['skuCount'],
    queryFn: () => base44.entities.SKU.list('-created_date', 1),
  });

  const { data: meals = [] } = useQuery({
    queryKey: ['mealCount'],
    queryFn: () => base44.entities.Meal.list('-created_date', 1),
  });

  const roleColors = {
    admin: 'bg-red-100 text-red-700',
    kitchen_manager: 'bg-blue-100 text-blue-700',
    stock_controller: 'bg-amber-100 text-amber-700',
    viewer: 'bg-gray-100 text-gray-700',
    user: 'bg-gray-100 text-gray-700',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">App configuration and user management</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Users */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Team Members</h3>
          </div>
          <div className="divide-y divide-border">
            {users.map(user => (
              <div key={user.id} className="px-6 py-3 flex items-center justify-between hover:bg-muted/30">
                <div>
                  <p className="text-sm font-medium">{user.full_name || user.email}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${roleColors[user.role] || 'bg-gray-100 text-gray-700'}`}>
                  {user.role || 'user'}
                </span>
              </div>
            ))}
            {users.length === 0 && (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">No users found</div>
            )}
          </div>
        </div>

        {/* System Info */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <Database className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">System Overview</h3>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">App Version</span>
              <span className="text-sm font-medium">1.0.0</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Active Users</span>
              <span className="text-sm font-medium">{users.length}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Shopify Integration</span>
              <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700">Not Connected</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Environment</span>
              <span className="text-sm font-medium">Production</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}