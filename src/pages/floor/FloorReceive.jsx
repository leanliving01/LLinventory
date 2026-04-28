import React from 'react';
import { Truck } from 'lucide-react';

export default function FloorReceive() {
  return (
    <div className="text-center py-16 space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mx-auto">
        <Truck className="w-8 h-8 text-orange-600" />
      </div>
      <h1 className="text-2xl font-bold">Receive Stock</h1>
      <p className="text-sm text-muted-foreground max-w-xs mx-auto">
        Receive deliveries against purchase orders. This module is coming in Phase 1F.
      </p>
    </div>
  );
}