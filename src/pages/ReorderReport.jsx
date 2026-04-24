import React from 'react';
import { AlertTriangle } from 'lucide-react';

export default function ReorderReport() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Reorder Report</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Items below reorder point</p>
      </div>
      <div className="bg-card border border-border rounded-xl px-6 py-16 text-center">
        <AlertTriangle className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-muted-foreground">Coming Soon</h2>
        <p className="text-sm text-muted-foreground mt-1">Reorder reporting will be built in section 5.4.4.</p>
      </div>
    </div>
  );
}