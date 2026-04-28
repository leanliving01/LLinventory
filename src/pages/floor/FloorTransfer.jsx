import React from 'react';
import { ArrowLeftRight } from 'lucide-react';

export default function FloorTransfer() {
  return (
    <div className="text-center py-16 space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mx-auto">
        <ArrowLeftRight className="w-8 h-8 text-purple-600" />
      </div>
      <h1 className="text-2xl font-bold">Transfer Stock</h1>
      <p className="text-sm text-muted-foreground max-w-xs mx-auto">
        Move stock between warehouse zones. This module is coming in Phase 1E.
      </p>
    </div>
  );
}