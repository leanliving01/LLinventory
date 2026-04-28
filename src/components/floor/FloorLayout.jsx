import React from 'react';
import { Outlet } from 'react-router-dom';
import FloorTopBar from './FloorTopBar';
import FloorBottomNav from './FloorBottomNav';

/**
 * Full-screen mobile-first layout for floor staff.
 * No sidebar — just a slim top bar + bottom nav with big tap targets.
 */
export default function FloorLayout() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <FloorTopBar />
      <main className="flex-1 overflow-y-auto pb-20">
        <div className="p-4 max-w-2xl mx-auto">
          <Outlet />
        </div>
      </main>
      <FloorBottomNav />
    </div>
  );
}