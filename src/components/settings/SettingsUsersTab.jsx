import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Users } from 'lucide-react';

const roleColors = {
  admin: 'bg-red-100 text-red-700',
  owner: 'bg-purple-100 text-purple-700',
  ops_manager: 'bg-blue-100 text-blue-700',
  kitchen_manager: 'bg-blue-100 text-blue-700',
  production_supervisor: 'bg-green-100 text-green-700',
  picker_packer: 'bg-amber-100 text-amber-700',
  stock_controller: 'bg-orange-100 text-orange-700',
  viewer: 'bg-gray-100 text-gray-700',
  user: 'bg-gray-100 text-gray-700',
};

export default function SettingsUsersTab() {
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list('-created_date', 50),
  });

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden max-w-2xl">
      <div className="px-6 py-4 border-b border-border flex items-center gap-2">
        <Users className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Team Members ({users.length})</h3>
      </div>
      <div className="divide-y divide-border">
        {users.map(user => (
          <div key={user.id} className="px-6 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{user.full_name || user.email}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${roleColors[user.role] || 'bg-gray-100 text-gray-700'}`}>
              {(user.role || 'user').replace(/_/g, ' ')}
            </span>
          </div>
        ))}
        {users.length === 0 && (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">No users found</div>
        )}
      </div>
    </div>
  );
}