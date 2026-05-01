import React from 'react';
import { TrendingUp } from 'lucide-react';

export default function SupplierYieldDashboard() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <TrendingUp className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Supplier Yield Performance</h1>
      </div>
      <p className="text-sm text-muted-foreground">Phase C — Rolling averages, supplier comparison, and procurement reporting.</p>
    </div>
  );
}