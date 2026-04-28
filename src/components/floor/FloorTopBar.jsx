import React from 'react';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { LogOut, Moon, Sun, LayoutDashboard } from 'lucide-react';
import { Link } from 'react-router-dom';

const ADMIN_ROLES = ['admin', 'ops_manager', 'kitchen_manager'];

export default function FloorTopBar() {
  const { user, logout } = useAuth();
  const isDark = document.documentElement.classList.contains('dark');
  const canSeeAdmin = ADMIN_ROLES.includes(user?.role);

  const toggleDark = () => {
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  };

  return (
    <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 shrink-0 z-30">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-bold text-xs">LL</span>
        </div>
        <span className="font-semibold text-sm">Floor</span>
      </div>
      <div className="flex items-center gap-1">
        {canSeeAdmin && (
          <Link to="/">
            <Button variant="ghost" size="icon" className="h-9 w-9" title="Admin Dashboard">
              <LayoutDashboard className="w-4 h-4" />
            </Button>
          </Link>
        )}
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={toggleDark}>
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => logout()}>
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}