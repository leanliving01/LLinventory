import React from 'react';
import { PackageCheck } from 'lucide-react';

export default function FloorPick() {
  return (
    <div className="text-center py-16 space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto">
        <PackageCheck className="w-8 h-8 text-blue-600" />
      </div>
      <h1 className="text-2xl font-bold">Pick & Pack</h1>
      <p className="text-sm text-muted-foreground max-w-xs mx-auto">
        Pick orders, scan items, and pack for dispatch. This module is coming in Phase 1C.
      </p>
    </div>
  );
}