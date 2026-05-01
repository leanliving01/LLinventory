import React from 'react';
import { ClipboardCheck } from 'lucide-react';

export default function WipPlanning() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ClipboardCheck className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">WIP-Aware Production Planning</h1>
      </div>
      <p className="text-sm text-muted-foreground">Shows available approved WIP per bulk product, today's meal-driven bulk requirement, and the net production requirement.</p>
    </div>
  );
}