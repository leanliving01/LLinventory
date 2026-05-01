import React from 'react';
import { Package } from 'lucide-react';

export default function WipInventory() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Package className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Bulk Cooked Inventory (WIP)</h1>
      </div>
      <p className="text-sm text-muted-foreground">Phase B — WIP batch management, quality checks, and write-offs.</p>
    </div>
  );
}