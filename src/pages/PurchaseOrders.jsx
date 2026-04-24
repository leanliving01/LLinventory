import React from 'react';
import { Receipt } from 'lucide-react';

export default function PurchaseOrders() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Purchase Orders</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Create and manage purchase orders</p>
      </div>
      <div className="bg-card border border-border rounded-xl px-6 py-16 text-center">
        <Receipt className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-muted-foreground">Coming Soon</h2>
        <p className="text-sm text-muted-foreground mt-1">PO creation and lifecycle tracking will be built in section 5.4.2.</p>
      </div>
    </div>
  );
}