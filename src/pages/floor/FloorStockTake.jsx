import React from 'react';
import { ClipboardCheck } from 'lucide-react';

export default function FloorStockTake() {
  return (
    <div className="text-center py-16 space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
        <ClipboardCheck className="w-8 h-8 text-green-600" />
      </div>
      <h1 className="text-2xl font-bold">Stock Count</h1>
      <p className="text-sm text-muted-foreground max-w-xs mx-auto">
        Count stock by zone using barcode scanning. This module is coming in Phase 1D.
      </p>
    </div>
  );
}