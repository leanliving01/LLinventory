import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import FloorTopBar from './FloorTopBar';
import FloorBottomNav from './FloorBottomNav';
import { cn } from '@/lib/utils';

/**
 * Full-screen mobile-first layout for floor staff.
 * No sidebar — just a slim top bar + bottom nav with big tap targets.
 * Tasks page uses full width for horizontal scrolling cards.
 */
export default function FloorLayout() {
  const location = useLocation();
  const isTasksPage = location.pathname === '/floor/tasks';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <FloorTopBar />
      <main className="flex-1 overflow-y-auto pb-20">
        <div className={cn("p-4", isTasksPage ? "max-w-full" : "max-w-2xl mx-auto")}>
          <Outlet />
        </div>
      </main>
      <FloorBottomNav />
    </div>
  );
}