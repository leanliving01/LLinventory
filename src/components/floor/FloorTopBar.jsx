import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { LogOut, Moon, Sun, LayoutDashboard } from 'lucide-react';
import { Link } from 'react-router-dom';

const ADMIN_ROLES = ['admin', 'ops_manager', 'kitchen_manager'];

function useLiveClock() {
  const [time, setTime] = useState(() => {
    const now = new Date();
    return now.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
  });

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false }));
    };
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  return time;
}

export default function FloorTopBar() {
  const { user, logout } = useAuth();
  const isDark = document.documentElement.classList.contains('dark');
  const canSeeAdmin = ADMIN_ROLES.includes(user?.role);
  const firstName = user?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'Floor';
  const clock = useLiveClock();

  const toggleDark = () => {
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  };

  return (
    <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 shrink-0 z-30">
      {/* Left: logo + first name */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground font-bold text-xs">LL</span>
        </div>
        <span className="font-semibold text-sm truncate">{firstName}</span>
      </div>

      {/* Center: live clock */}
      <span className="absolute left-1/2 -translate-x-1/2 font-mono text-sm font-semibold tabular-nums text-foreground/80">
        {clock}
      </span>

      {/* Right: controls */}
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
