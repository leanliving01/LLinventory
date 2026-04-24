import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { cn } from '@/lib/utils';

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <div className="print:hidden" data-sidebar>
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </div>
      <main className={cn(
        "transition-all duration-300 min-h-screen print:ml-0",
        collapsed ? "ml-16" : "ml-60"
      )}>
        <div className="p-6 max-w-[1600px] print:p-2 print:max-w-none">
          <Outlet />
        </div>
      </main>
    </div>
  );
}